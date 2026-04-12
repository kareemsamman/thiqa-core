import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowRight, Save, CreditCard, Settings, Loader2, Building2,
  MessageSquare, Palette, Users, Shield, Phone, Mail, Image, Bot,
  Upload, Trash2, Eye, EyeOff, Plus, UserPlus, UserMinus, CalendarIcon,
} from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { useAgentContext } from "@/hooks/useAgentContext";
import { DateInputPicker } from "@/components/shared/DateInputPicker";

// ─── Usage Limits Editor ───
function UsageLimitsEditor({ agentId }: { agentId: string }) {
  const [limits, setLimits] = useState<any>(null);
  const [usage, setUsage] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [limitsRes, usageRes] = await Promise.all([
        supabase.from('agent_usage_limits' as any).select('*').eq('agent_id', agentId).maybeSingle(),
        supabase.from('agent_usage_log' as any).select('*').eq('agent_id', agentId).order('period', { ascending: false }).limit(12),
      ]);
      if (limitsRes.data) setLimits(limitsRes.data);
      else setLimits({ sms_limit_type: 'monthly', sms_limit_count: 100, ai_limit_type: 'monthly', ai_limit_count: 100 });
      setUsage((usageRes.data as any) || []);
      setLoaded(true);
    })();
  }, [agentId]);

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      agent_id: agentId,
      sms_limit_type: limits.sms_limit_type,
      sms_limit_count: limits.sms_limit_count,
      ai_limit_type: limits.ai_limit_type,
      ai_limit_count: limits.ai_limit_count,
    };
    const { error } = await supabase.from('agent_usage_limits' as any).upsert(payload, { onConflict: 'agent_id' });
    setSaving(false);
    if (error) toast.error('فشل في الحفظ: ' + error.message);
    else toast.success('تم حفظ حدود الاستخدام');
  };

  if (!loaded) return null;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentYear = String(now.getFullYear());
  const smsUsedMonth = usage.find((u: any) => u.usage_type === 'sms' && u.period === currentMonth)?.count || 0;
  const smsUsedYear = usage.filter((u: any) => u.usage_type === 'sms' && u.period.startsWith(currentYear)).reduce((s: number, u: any) => s + u.count, 0);
  const aiUsedMonth = usage.find((u: any) => u.usage_type === 'ai_chat' && u.period === currentMonth)?.count || 0;
  const aiUsedYear = usage.filter((u: any) => u.usage_type === 'ai_chat' && u.period.startsWith(currentYear)).reduce((s: number, u: any) => s + u.count, 0);

  const limitTypeLabels: Record<string, string> = { monthly: 'شهري', yearly: 'سنوي', unlimited: 'غير محدود' };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SMS Limits */}
        <div className="border rounded-lg p-4 space-y-3">
          <h4 className="font-bold text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4" />حدود SMS</h4>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">النوع</Label>
              <Select value={limits.sms_limit_type} onValueChange={v => setLimits({...limits, sms_limit_type: v})}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">شهري</SelectItem>
                  <SelectItem value="yearly">سنوي</SelectItem>
                  <SelectItem value="unlimited">غير محدود</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {limits.sms_limit_type !== 'unlimited' && (
              <div>
                <Label className="text-xs">الحد الأقصى</Label>
                <Input type="number" className="h-8 text-xs" value={limits.sms_limit_count} onChange={e => setLimits({...limits, sms_limit_count: parseInt(e.target.value) || 0})} />
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            الاستخدام: <strong>{smsUsedMonth}</strong> هذا الشهر | <strong>{smsUsedYear}</strong> هذا العام
          </div>
        </div>

        {/* AI Limits */}
        <div className="border rounded-lg p-4 space-y-3">
          <h4 className="font-bold text-sm flex items-center gap-2"><Bot className="h-4 w-4" />حدود المساعد الذكي</h4>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">النوع</Label>
              <Select value={limits.ai_limit_type} onValueChange={v => setLimits({...limits, ai_limit_type: v})}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">شهري</SelectItem>
                  <SelectItem value="yearly">سنوي</SelectItem>
                  <SelectItem value="unlimited">غير محدود</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {limits.ai_limit_type !== 'unlimited' && (
              <div>
                <Label className="text-xs">الحد الأقصى</Label>
                <Input type="number" className="h-8 text-xs" value={limits.ai_limit_count} onChange={e => setLimits({...limits, ai_limit_count: parseInt(e.target.value) || 0})} />
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            الاستخدام: <strong>{aiUsedMonth}</strong> هذا الشهر | <strong>{aiUsedYear}</strong> هذا العام
          </div>
        </div>
      </div>
      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
        حفظ الحدود
      </Button>
    </div>
  );
}

// ─── Feature flags ───
const ALL_FEATURES = [
  { key: 'sms', label: 'إرسال SMS', description: 'إرسال رسائل نصية للعملاء' },
  { key: 'financial_reports', label: 'التقارير المالية', description: 'عرض التقارير المالية' },
  { key: 'broker_wallet', label: 'محفظة الوسطاء', description: 'إدارة محفظة الوسطاء' },
  { key: 'company_settlement', label: 'تسويات الشركات', description: 'تقارير تسويات شركات التأمين' },
  { key: 'expenses', label: 'السندات والمصروفات', description: 'إدارة سندات القبض والصرف' },
  { key: 'cheques', label: 'الشيكات', description: 'إدارة الشيكات' },
  { key: 'leads', label: 'Whatsapp Leads', description: 'عملاء الواتساب المحتملين' },
  { key: 'accident_reports', label: 'بلاغات الحوادث', description: 'إدارة بلاغات الحوادث' },
  { key: 'repair_claims', label: 'المطالبات', description: 'إدارة مطالبات التصليح' },
  { key: 'marketing_sms', label: 'SMS تسويقية', description: 'حملات SMS تسويقية' },
  { key: 'road_services', label: 'خدمات الطريق', description: 'إدارة خدمات الطريق' },
  { key: 'accident_fees', label: 'رسوم الحوادث', description: 'إعفاء رسوم الحادث' },
  { key: 'correspondence', label: 'الترويسات', description: 'إدارة المراسلات' },
  { key: 'visa_payment', label: 'دفع بالفيزا', description: 'السماح بالدفع عبر بطاقة ائتمان (فيزا)' },
  { key: 'receipts', label: 'الإيصالات', description: 'نظام إدارة الإيصالات وطباعتها' },
  { key: 'accounting', label: 'المحاسبة', description: 'دفتر محاسبة موحد' },
  { key: 'renewal_reports', label: 'تقارير التجديد', description: 'متابعة تجديد الوثائق' },
  { key: 'ai_assistant', label: 'المساعد الذكي (ثاقب)', description: 'مساعد AI للاستعلام عن بيانات النظام' },
  { key: 'ippbx', label: 'Click2Call / PBX', description: 'الاتصال عبر المقسم' },
];

interface AgentDetail {
  id: string;
  name: string;
  name_ar: string | null;
  email: string;
  phone: string | null;
  logo_url: string | null;
  plan: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  monthly_price: number | null;
  notes: string | null;
}

export default function ThiqaAgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { startImpersonation } = useAgentContext();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [agents_original_plan, setOriginalPlan] = useState<string>("");
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [payments, setPayments] = useState<any[]>([]);
  const [unbilledOverages, setUnbilledOverages] = useState<any[]>([]);
  const [includeOveragesInPayment, setIncludeOveragesInPayment] = useState(false);
  const [dbPlans, setDbPlans] = useState<{plan_key: string; name: string; monthly_price: number}[]>([]);
  const [agentStats, setAgentStats] = useState<{clients: number; cars: number; policies: number} | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [agentUsers, setAgentUsers] = useState<any[]>([]);
  const [userRoles, setUserRoles] = useState<Record<string, string>>({});
  const [branches, setBranches] = useState<any[]>([]);
  const [smsSettings, setSmsSettings] = useState<any>(null);
  const [authSettings, setAuthSettings] = useState<any>(null);
  const [paymentSettings, setPaymentSettings] = useState<any>(null);
  const [siteSettings, setSiteSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPhone, setNewUserPhone] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "worker">("worker");
  const [newUserBranch, setNewUserBranch] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState("info");
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [periodStart, setPeriodStart] = useState<Date>(new Date());
  const [periodEnd, setPeriodEnd] = useState<Date>(() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; });
  const [deleteAgentOpen, setDeleteAgentOpen] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState(false);
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [editingPayment, setEditingPayment] = useState<any>(null);
  const [editPaymentAmount, setEditPaymentAmount] = useState("");
  const [editPaymentNotes, setEditPaymentNotes] = useState("");
  const [editPeriodStart, setEditPeriodStart] = useState<Date>(new Date());
  const [editPeriodEnd, setEditPeriodEnd] = useState<Date>(new Date());
  const [savingPayment, setSavingPayment] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editUserName, setEditUserName] = useState("");
  const [editUserPhone, setEditUserPhone] = useState("");
  const [editUserBranch, setEditUserBranch] = useState("");
  const [editUserPassword, setEditUserPassword] = useState("");
  const [savingUser, setSavingUser] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<Record<string, { inserted: number; errors: number }> | null>(null);
  const [importProgress, setImportProgress] = useState("");
  const [importTableIndex, setImportTableIndex] = useState(-1);
  const [importStartTime, setImportStartTime] = useState<number | null>(null);
  const [importElapsed, setImportElapsed] = useState(0);
  const [importTotalRows, setImportTotalRows] = useState(0);
  const [importDoneRows, setImportDoneRows] = useState(0);

  // Elapsed time ticker for import
  useEffect(() => {
    if (!importStartTime) return;
    const interval = setInterval(() => setImportElapsed(Math.floor((Date.now() - importStartTime) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [importStartTime]);

  useEffect(() => {
    if (agentId) fetchAll();
  }, [agentId]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [agentRes, flagsRes, paymentsRes, usersRes, smsRes, authRes, payRes, siteRes, rolesRes, branchRes, plansRes, overagesRes] = await Promise.all([
        supabase.from('agents').select('*').eq('id', agentId!).single(),
        supabase.from('agent_feature_flags').select('feature_key, enabled').eq('agent_id', agentId!),
        supabase.from('agent_subscription_payments').select('*').eq('agent_id', agentId!).order('payment_date', { ascending: false }).limit(50),
        supabase.from('agent_users').select('*, profiles:user_id(id, email, full_name, status, phone, branch_id, email_confirmed)').eq('agent_id', agentId!),
        supabase.from('sms_settings').select('*').eq('agent_id', agentId!).maybeSingle(),
        supabase.from('auth_settings').select('*').eq('agent_id', agentId!).maybeSingle(),
        supabase.from('payment_settings').select('*').eq('agent_id', agentId!).maybeSingle(),
        supabase.from('site_settings').select('*').eq('agent_id', agentId!).maybeSingle(),
        supabase.from('user_roles').select('user_id, role').eq('agent_id', agentId!),
        supabase.from('branches').select('id, name, name_ar').eq('agent_id', agentId!),
        supabase.from('subscription_plans').select('plan_key, name, monthly_price').eq('is_active', true).order('sort_order'),
        supabase
          .from('agent_usage_overages' as any)
          .select('id, usage_type, extra_count, unit_price, total_amount, created_at')
          .eq('agent_id', agentId!)
          .eq('billed', false)
          .order('created_at', { ascending: false }),
      ]);

      if (agentRes.data) {
        setAgent(agentRes.data as AgentDetail);
        setOriginalPlan((agentRes.data as AgentDetail).plan);
      }
      const featureMap: Record<string, boolean> = {};
      if (flagsRes.data) flagsRes.data.forEach((f: any) => { featureMap[f.feature_key] = f.enabled; });
      setFeatures(featureMap);
      if (paymentsRes.data) setPayments(paymentsRes.data);
      if (usersRes.data) setAgentUsers(usersRes.data);
      if (smsRes.data) setSmsSettings(smsRes.data);
      if (authRes.data) setAuthSettings(authRes.data);
      if (payRes.data) setPaymentSettings(payRes.data);
      if (siteRes.data) setSiteSettings(siteRes.data);
      const rm: Record<string, string> = {};
      if (rolesRes.data) rolesRes.data.forEach((r: any) => { rm[r.user_id] = r.role; });
      setUserRoles(rm);
      if (branchRes.data) setBranches(branchRes.data);
      if (plansRes.data && plansRes.data.length > 0) setDbPlans(plansRes.data);
      setUnbilledOverages(((overagesRes.data as any) || []));
      // Fetch stats in background
      fetchAgentStats();
    } catch (error) {
      console.error('Error fetching agent data:', error);
      toast.error('خطأ في تحميل بيانات الوكيل');
    } finally {
      setLoading(false);
    }
  };

  const fetchAgentStats = async () => {
    if (!agentId) return;
    setStatsLoading(true);
    const [clientsRes, carsRes, policiesRes] = await Promise.all([
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('agent_id', agentId),
      supabase.from('cars').select('id', { count: 'exact', head: true }).eq('agent_id', agentId).is('deleted_at', null),
      supabase.from('policies').select('id', { count: 'exact', head: true }).eq('agent_id', agentId),
    ]);
    setAgentStats({
      clients: clientsRes.count || 0,
      cars: carsRes.count || 0,
      policies: policiesRes.count || 0,
    });
    setStatsLoading(false);
  };

  // ─── Save agent info ───
  const saveAgent = async () => {
    if (!agent) return;
    setSaving(true);

    // Detect plan change to auto-update feature flags
    const prevPlan = agents_original_plan;
    const newPlan = agent.plan;

    const { error } = await supabase
      .from('agents')
      .update({
        name: agent.name, name_ar: agent.name_ar, email: agent.email,
        phone: agent.phone, plan: agent.plan,
        subscription_status: agent.subscription_status,
        subscription_expires_at: agent.subscription_expires_at,
        monthly_price: agent.monthly_price, notes: agent.notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agent.id);

    // Auto-set feature flags if plan changed
    if (!error && prevPlan !== newPlan) {
      const { error: featErr } = await supabase.rpc("set_features_for_plan", {
        p_agent_id: agent.id,
        p_plan: newPlan,
      });
      if (featErr) {
        console.error("Feature flags update error:", featErr);
      } else {
        toast.info("تم تحديث الميزات تلقائياً حسب الخطة الجديدة");
        // Refresh features
        const { data: ff } = await supabase.from('agent_feature_flags').select('feature_key, enabled').eq('agent_id', agent.id);
        const featureMap: Record<string, boolean> = {};
        (ff || []).forEach((f: any) => { featureMap[f.feature_key] = f.enabled; });
        setFeatures(featureMap);
      }
      setOriginalPlan(newPlan);
    }

    setSaving(false);
    error ? toast.error('خطأ في الحفظ') : toast.success('تم الحفظ');
  };

  // ─── Toggle feature ───
  const toggleFeature = async (key: string, enabled: boolean) => {
    setFeatures(prev => ({ ...prev, [key]: enabled }));
    await supabase.from('agent_feature_flags')
      .upsert({ agent_id: agentId!, feature_key: key, enabled }, { onConflict: 'agent_id,feature_key' });
  };

  // ─── Extend subscription ───
  const extendSubscription = async () => {
    if (!agent) return;
    const cur = agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : new Date();
    const newExp = new Date(cur);
    newExp.setMonth(newExp.getMonth() + 1);
    const { error } = await supabase.from('agents').update({
      subscription_expires_at: newExp.toISOString(),
      subscription_status: 'active',
      updated_at: new Date().toISOString(),
    }).eq('id', agent.id);
    if (!error) {
      toast.success('تم تمديد الاشتراك شهر');
      setAgent(prev => prev ? { ...prev, subscription_expires_at: newExp.toISOString(), subscription_status: 'active' } : null);
    }
  };

  // ─── Record payment ───
  const recordPayment = async () => {
    if (!agent || !paymentAmount) return;

    // Mark all existing active payments as done
    await supabase.from('agent_subscription_payments')
      .update({ status: 'done' } as any)
      .eq('agent_id', agent.id)
      .eq('status', 'active');

    const { error } = await supabase.from('agent_subscription_payments').insert({
      agent_id: agent.id, amount: parseFloat(paymentAmount), plan: agent.plan,
      payment_date: format(paymentDate, 'yyyy-MM-dd'),
      period_start: format(periodStart, 'yyyy-MM-dd'),
      period_end: format(periodEnd, 'yyyy-MM-dd'),
      received_by: user?.id, notes: paymentNotes || null,
      status: 'active',
    } as any);
    if (!error) {
      // If the admin ticked "include unbilled overages", mark every unbilled
      // overage row for this agent as billed so the agent's next-billing
      // preview clears and we don't double-charge them next month.
      if (includeOveragesInPayment && unbilledOverages.length > 0) {
        const ids = unbilledOverages.map((o) => o.id);
        const { error: markErr } = await supabase
          .from('agent_usage_overages' as any)
          .update({ billed: true } as any)
          .in('id', ids);
        if (markErr) {
          console.error('[record-payment] failed to mark overages billed:', markErr);
          toast.error('تم تسجيل الدفعة لكن فشل تحديث حالة الإضافات');
        }
      }

      // Always update agent expiry to the new period_end
      const periodEndStr = format(periodEnd, 'yyyy-MM-dd');
      await supabase.from('agents').update({
        subscription_expires_at: new Date(periodEndStr).toISOString(),
        subscription_status: 'active',
        updated_at: new Date().toISOString(),
      }).eq('id', agent.id);
      setAgent(prev => prev ? { ...prev, subscription_expires_at: new Date(periodEndStr).toISOString(), subscription_status: 'active' } : null);

      toast.success('تم تسجيل الدفعة');
      setPaymentAmount(""); setPaymentNotes(""); setPaymentDate(new Date());
      setIncludeOveragesInPayment(false);
      const d = new Date(); setPeriodStart(d); const e = new Date(d); e.setMonth(e.getMonth() + 1); setPeriodEnd(e);
      fetchAll();
    }
  };

  // ─── Mark unbilled overages as billed without recording a new payment ───
  const markOveragesAsBilled = async () => {
    if (!agentId || unbilledOverages.length === 0) return;
    const ids = unbilledOverages.map((o) => o.id);
    const { error } = await supabase
      .from('agent_usage_overages' as any)
      .update({ billed: true } as any)
      .in('id', ids);
    if (error) {
      toast.error('فشل في تحديث حالة الإضافات');
      return;
    }
    toast.success(`تم تسوية ${ids.length} من الإضافات`);
    fetchAll();
  };

  // ─── Auto-calc period end when start changes ───
  const handlePeriodStartChange = (date: Date) => {
    setPeriodStart(date);
    const end = new Date(date);
    end.setMonth(end.getMonth() + 1);
    setPeriodEnd(end);
  };

  const handleEditPeriodStartChange = (date: Date) => {
    setEditPeriodStart(date);
    const end = new Date(date);
    end.setMonth(end.getMonth() + 1);
    setEditPeriodEnd(end);
  };

  const openEditPayment = (p: any) => {
    setEditingPayment(p);
    setEditPaymentAmount(String(p.amount));
    setEditPaymentNotes(p.notes || '');
    setEditPeriodStart(p.period_start ? new Date(p.period_start) : new Date(p.payment_date));
    setEditPeriodEnd(p.period_end ? new Date(p.period_end) : new Date(p.payment_date));
  };

  const saveEditPayment = async () => {
    if (!editingPayment) return;
    setSavingPayment(true);
    const { error } = await supabase.from('agent_subscription_payments').update({
      amount: parseFloat(editPaymentAmount),
      notes: editPaymentNotes || null,
      period_start: format(editPeriodStart, 'yyyy-MM-dd'),
      period_end: format(editPeriodEnd, 'yyyy-MM-dd'),
    } as any).eq('id', editingPayment.id);
    setSavingPayment(false);
    if (error) { toast.error('خطأ في تحديث الدفعة'); return; }
    toast.success('تم تحديث الدفعة');
    setEditingPayment(null);
    fetchAll();
  };

  // ─── Save SMS settings ───
  const saveSmsSettings = async () => {
    setSavingSection('sms');
    if (smsSettings?.id) {
      const { error } = await supabase.from('sms_settings').update({
        sms_user: smsSettings.sms_user, sms_token: smsSettings.sms_token,
        sms_source: smsSettings.sms_source, is_enabled: smsSettings.is_enabled,
        updated_at: new Date().toISOString(),
      }).eq('id', smsSettings.id);
      if (error) { setSavingSection(null); toast.error('فشل في حفظ إعدادات SMS: ' + error.message); return; }
    } else {
      const { data, error } = await supabase.from('sms_settings').insert({
        agent_id: agentId!, provider: '019',
        sms_user: smsSettings?.sms_user || '', sms_token: smsSettings?.sms_token || '',
        sms_source: smsSettings?.sms_source || '', is_enabled: smsSettings?.is_enabled ?? false,
      }).select().single();
      if (error) { setSavingSection(null); toast.error('فشل في حفظ إعدادات SMS: ' + error.message); return; }
      if (data) setSmsSettings(data);
    }
    setSavingSection(null);
    toast.success('تم حفظ إعدادات SMS');
  };

  // ─── Save auth settings ───
  const saveAuthSettings = async () => {
    setSavingSection('auth');
    if (authSettings?.id) {
      const { error } = await supabase.from('auth_settings').update({
        sms_otp_enabled: authSettings.sms_otp_enabled,
        sms_019_user: authSettings.sms_019_user, sms_019_token: authSettings.sms_019_token,
        sms_019_source: authSettings.sms_019_source,
        email_otp_enabled: authSettings.email_otp_enabled,
        smtp_host: authSettings.smtp_host, smtp_port: authSettings.smtp_port,
        smtp_user: authSettings.smtp_user, smtp_password: authSettings.smtp_password,
        ippbx_enabled: authSettings.ippbx_enabled,
        ippbx_token_id: authSettings.ippbx_token_id,
        updated_at: new Date().toISOString(),
      }).eq('id', authSettings.id);
      if (error) { setSavingSection(null); toast.error('فشل في حفظ إعدادات المصادقة: ' + error.message); return; }
    } else {
      const { data, error } = await supabase.from('auth_settings').insert({
        agent_id: agentId!, ...authSettings,
      }).select().single();
      if (error) { setSavingSection(null); toast.error('فشل في حفظ إعدادات المصادقة: ' + error.message); return; }
      if (data) setAuthSettings(data);
    }
    setSavingSection(null);
    toast.success('تم حفظ إعدادات المصادقة');
  };

  // ─── Save payment/Tranzila settings ───
  const savePaymentSettings = async () => {
    setSavingSection('payment');
    if (paymentSettings?.id) {
      const { error } = await supabase.from('payment_settings').update({
        terminal_name: paymentSettings.terminal_name,
        api_password: paymentSettings.api_password,
        is_enabled: paymentSettings.is_enabled,
        test_mode: paymentSettings.test_mode,
        sandbox_terminal_name: paymentSettings.sandbox_terminal_name,
        success_url: paymentSettings.success_url,
        fail_url: paymentSettings.fail_url,
        notify_url: paymentSettings.notify_url,
        updated_at: new Date().toISOString(),
      }).eq('id', paymentSettings.id);
      if (error) { setSavingSection(null); toast.error('فشل في حفظ إعدادات الدفع: ' + error.message); return; }
    } else {
      const { data, error } = await supabase.from('payment_settings').insert({
        agent_id: agentId!, provider: 'tranzila', ...paymentSettings,
      }).select().single();
      if (error) { setSavingSection(null); toast.error('فشل في حفظ إعدادات الدفع: ' + error.message); return; }
      if (data) setPaymentSettings(data);
    }
    setSavingSection(null);
    toast.success('تم حفظ إعدادات الدفع');
  };

  // ─── Save site/branding settings ───
  const saveSiteSettings = async () => {
    setSavingSection('site');
    if (siteSettings?.id) {
      await supabase.from('site_settings').update({
        site_title: siteSettings.site_title, site_description: siteSettings.site_description,
        logo_url: siteSettings.logo_url, favicon_url: siteSettings.favicon_url,
        og_image_url: siteSettings.og_image_url,
        updated_at: new Date().toISOString(),
      }).eq('id', siteSettings.id);
    } else {
      const { data } = await supabase.from('site_settings').insert({
        agent_id: agentId!, site_title: siteSettings?.site_title || '',
        site_description: siteSettings?.site_description || '',
        logo_url: siteSettings?.logo_url || null,
      }).select().single();
      if (data) setSiteSettings(data);
    }
    setSavingSection(null);
    toast.success('تم حفظ العلامة التجارية');
  };

  // ─── Create new user for agent ───
  const createUserForAgent = async () => {
    if (!newUserEmail.trim() || !newUserPassword.trim()) {
      toast.error('يرجى إدخال البريد الإلكتروني وكلمة المرور');
      return;
    }
    if (newUserPassword.length < 6) {
      toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    setCreatingUser(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-agent-user', {
        body: {
          email: newUserEmail.trim(),
          password: newUserPassword,
          full_name: newUserName.trim() || null,
          phone: newUserPhone.trim() || null,
          agent_id: agentId!,
          role: newUserRole,
          branch_id: newUserBranch && newUserBranch !== 'none' ? newUserBranch : null,
        },
      });

      if (error) {
        let message = error.message || 'خطأ في إنشاء المستخدم';
        const context = (error as any).context;

        if (context) {
          try {
            const payload = await context.json();
            message = payload?.error || payload?.message || message;
          } catch {
            // keep fallback message
          }
        }

        throw new Error(message);
      }

      if (data?.error) throw new Error(data.error);

      toast.success(
        data?.reused_existing_user
          ? 'تم ربط مستخدم موجود بالوكيل بنجاح'
          : 'تم إنشاء المستخدم بنجاح'
      );
      setNewUserEmail(''); setNewUserPassword(''); setNewUserName(''); setNewUserPhone('');
      setNewUserRole('worker'); setNewUserBranch('');
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || 'خطأ في إنشاء المستخدم');
    } finally {
      setCreatingUser(false);
    }
  };

  // ─── Remove user from agent ───
  const removeUserFromAgent = async (userId: string) => {
    await Promise.all([
      supabase.from('agent_users').delete().eq('agent_id', agentId!).eq('user_id', userId),
      supabase.from('profiles').update({ agent_id: null }).eq('id', userId),
      supabase.from('user_roles').delete().eq('user_id', userId).eq('agent_id', agentId!),
    ]);
    toast.success('تم إزالة المستخدم');
    fetchAll();
  };

  // ─── Change user role ───
  const changeUserRole = async (userId: string, newRole: 'admin' | 'worker') => {
    // Delete all existing roles for this user in this agent
    await supabase.from('user_roles').delete().eq('user_id', userId).eq('agent_id', agentId!);
    // Insert the new role
    const { error } = await supabase.from('user_roles').insert({
      user_id: userId, role: newRole, agent_id: agentId!,
    });
    if (error) {
      toast.error('خطأ في تغيير الصلاحية: ' + error.message);
      return;
    }
    setUserRoles(prev => ({ ...prev, [userId]: newRole }));
    toast.success('تم تغيير الصلاحية');
  };

  // ─── Delete agent (via edge function) ───
  const deleteAgent = async () => {
    setDeletingAgent(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-agent', {
        body: { agent_id: agentId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('تم حذف الوكيل بنجاح');
      navigate('/thiqa/agents');
    } catch (err: any) {
      toast.error(err.message || 'خطأ في حذف الوكيل');
    } finally {
      setDeletingAgent(false);
      setDeleteAgentOpen(false);
    }
  };

  // ─── Delete payment ───
  const deletePayment = async (paymentId: string) => {
    const { error } = await supabase.from('agent_subscription_payments').delete().eq('id', paymentId);
    if (error) { toast.error('خطأ في حذف الدفعة'); return; }
    toast.success('تم حذف الدفعة');
    setDeletePaymentId(null);
    fetchAll();
  };

  // ─── Edit user ───
  const openEditUser = (au: any) => {
    const p = au.profiles;
    setEditingUser(au);
    setEditUserName(p?.full_name || '');
    setEditUserPhone(p?.phone || '');
    setEditUserBranch(p?.branch_id || 'none');
    setEditUserPassword('');
  };

  const saveEditUser = async () => {
    if (!editingUser) return;
    setSavingUser(true);
    
    // Update profile
    const { error } = await supabase.from('profiles').update({
      full_name: editUserName || null,
      phone: editUserPhone || null,
      branch_id: editUserBranch === 'none' ? null : editUserBranch || null,
    }).eq('id', editingUser.user_id);
    
    if (error) { 
      setSavingUser(false);
      toast.error('خطأ في تحديث المستخدم'); 
      return; 
    }

    // Update password if provided
    if (editUserPassword.trim()) {
      if (editUserPassword.length < 6) {
        setSavingUser(false);
        toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
        return;
      }
      const { data: pwData, error: pwError } = await supabase.functions.invoke('update-user-password', {
        body: { user_id: editingUser.user_id, new_password: editUserPassword },
      });
      if (pwError || pwData?.error) {
        setSavingUser(false);
        toast.error(pwData?.error || 'خطأ في تحديث كلمة المرور');
        return;
      }
    }

    setSavingUser(false);
    toast.success('تم تحديث المستخدم');
    setEditingUser(null);
    fetchAll();
  };

  const toggleToken = (key: string) => setShowTokens(prev => ({ ...prev, [key]: !prev[key] }));

  // ─── Import data for agent (table-by-table to avoid timeout) ───
  const IMPORT_TABLE_ORDER = [
    "branches", "insurance_companies", "insurance_categories", "pricing_rules",
    "brokers", "clients", "cars", "car_accidents", "policies", "policy_payments",
    "outside_cheques", "media_files", "invoice_templates", "invoices",
    "customer_signatures", "sms_settings", "payment_settings", "site_settings", "notifications",
  ];

  const TABLE_LABELS: Record<string, string> = {
    branches: "الفروع", insurance_companies: "شركات التأمين", insurance_categories: "فئات التأمين",
    pricing_rules: "قواعد التسعير", brokers: "الوسطاء", clients: "العملاء", cars: "السيارات",
    car_accidents: "حوادث السيارات", policies: "الوثائق", policy_payments: "المدفوعات",
    outside_cheques: "الشيكات", media_files: "الوسائط", invoice_templates: "قوالب الفواتير",
    invoices: "الفواتير", customer_signatures: "التوقيعات", sms_settings: "إعدادات SMS",
    payment_settings: "إعدادات الدفع", site_settings: "إعدادات الموقع", notifications: "الإشعارات",
  };




  const handleImportData = async () => {
    if (!importFile || !agentId) return;
    setImporting(true);
    setImportResults(null);
    setImportProgress("جاري قراءة الملف...");
    setImportTableIndex(-1);
    setImportDoneRows(0);
    setImportElapsed(0);

    try {
      const text = await importFile.text();
      const importData = JSON.parse(text);

      // Calculate total rows
      let total = 0;
      const tablesToProcess: string[] = [];
      for (const table of IMPORT_TABLE_ORDER) {
        const rows = importData[table];
        if (rows && Array.isArray(rows) && rows.length > 0) {
          total += rows.length;
          tablesToProcess.push(table);
        }
      }
      setImportTotalRows(total);
      setImportStartTime(Date.now());

      const allResults: Record<string, { inserted: number; errors: number }> = {};
      let doneRows = 0;

      for (let i = 0; i < tablesToProcess.length; i++) {
        const table = tablesToProcess[i];
        const rows = importData[table];
        setImportTableIndex(i);
        setImportProgress(`${TABLE_LABELS[table] || table} (${rows.length} سجل)`);

        const { data: result, error } = await supabase.functions.invoke('import-agent-data', {
          body: { agent_id: agentId, data: { [table]: rows }, tables: [table] },
        });

        if (error) {
          allResults[table] = { inserted: 0, errors: rows.length };
        } else if (result?.error) {
          allResults[table] = { inserted: 0, errors: rows.length };
        } else if (result?.results?.[table]) {
          allResults[table] = result.results[table];
        } else {
          allResults[table] = { inserted: rows.length, errors: 0 };
        }

        doneRows += rows.length;
        setImportDoneRows(doneRows);
        // Merge results live
        setImportResults({ ...allResults });
      }

      setImportProgress("");
      toast.success("تم استيراد البيانات بنجاح");
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || "خطأ في استيراد البيانات");
      setImportProgress("");
    } finally {
      setImporting(false);
      setImportStartTime(null);
      setImportTableIndex(-1);
    }
  };

  if (loading) {
    return <MainLayout><div className="space-y-4 p-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div></MainLayout>;
  }
  if (!agent) {
    return <MainLayout><div className="p-8 text-center text-muted-foreground">الوكيل غير موجود</div></MainLayout>;
  }

  const initSms = () => smsSettings || { sms_user: '', sms_token: '', sms_source: '', is_enabled: false };
  const initAuth = () => authSettings || {
    email_otp_enabled: false, sms_otp_enabled: false,
    smtp_host: '', smtp_port: 465, smtp_user: '', smtp_password: '',
    sms_019_user: '', sms_019_token: '', sms_019_source: '',
    ippbx_enabled: false, ippbx_token_id: '',
  };
  const initPay = () => paymentSettings || {
    terminal_name: '', api_password: '', is_enabled: false,
    test_mode: true, sandbox_terminal_name: 'demo5964',
    success_url: '', fail_url: '', notify_url: '',
  };
  const initSite = () => siteSettings || { site_title: '', site_description: '', logo_url: null, favicon_url: null, og_image_url: null };

  return (
    <MainLayout>
      <div className="space-y-4 md:space-y-6 overflow-x-hidden p-4 md:p-6" dir="rtl">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 md:gap-3">
            <Button variant="ghost" size="icon" className="flex-shrink-0" onClick={() => navigate('/thiqa/agents')}>
              <ArrowRight className="h-5 w-5" />
            </Button>
            {agent.logo_url ? (
              <img src={agent.logo_url} alt="" className="h-10 w-10 md:h-12 md:w-12 rounded-lg object-contain border flex-shrink-0" />
            ) : (
              <div className="h-10 w-10 md:h-12 md:w-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-5 w-5 md:h-6 md:w-6 text-primary" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-lg md:text-2xl font-bold truncate">{agent.name_ar || agent.name}</h1>
              <div className="flex flex-wrap items-center gap-1 md:gap-2 text-xs md:text-sm text-muted-foreground">
                <span className="truncate max-w-[150px] md:max-w-none">{agent.email}</span>
                <Badge className={cn("text-[10px] md:text-xs", agent.subscription_status === 'active' ? 'bg-green-600' : agent.subscription_status === 'paused' ? 'bg-yellow-500' : 'bg-destructive')}>
                  {agent.subscription_status === 'trial' ? 'تجربة مجانية' : agent.subscription_status === 'active' ? (agent.monthly_price === 0 ? 'تجربة مجانية' : 'فعال') : agent.subscription_status === 'paused' ? 'متوقف مؤقتاً' : agent.subscription_status === 'suspended' ? 'معلّق' : agent.subscription_status === 'cancelled' ? 'ملغي' : 'منتهي'}
                </Badge>
                <Badge variant="outline" className="text-[10px] md:text-xs">{agent.plan === 'pro' ? 'Pro' : 'Basic'}</Badge>
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="text-xs" onClick={() => {
              startImpersonation(agentId!);
              navigate('/');
            }}>
              <Building2 className="h-3.5 w-3.5 ml-1" />
              الدخول للنظام
            </Button>
            <Button variant="destructive" size="sm" className="text-xs" onClick={() => setDeleteAgentOpen(true)}>
              <Trash2 className="h-3.5 w-3.5 ml-1" />
              حذف الوكيل
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <TabsList className="inline-flex h-auto gap-1 w-max md:w-auto md:flex-wrap">
              <TabsTrigger value="info" className="text-xs md:text-sm px-2 md:px-3"><Settings className="h-3.5 w-3.5 md:h-4 md:w-4 ml-1" />معلومات</TabsTrigger>
              <TabsTrigger value="users" className="text-xs md:text-sm px-2 md:px-3"><Users className="h-3.5 w-3.5 md:h-4 md:w-4 ml-1" />المستخدمون</TabsTrigger>
              <TabsTrigger value="branding" className="text-xs md:text-sm px-2 md:px-3"><Palette className="h-3.5 w-3.5 md:h-4 md:w-4 ml-1" />العلامة</TabsTrigger>
              <TabsTrigger value="sms" className="text-xs md:text-sm px-2 md:px-3"><MessageSquare className="h-3.5 w-3.5 md:h-4 md:w-4 ml-1" />SMS</TabsTrigger>
              <TabsTrigger value="auth" className="text-xs md:text-sm px-2 md:px-3"><Shield className="h-3.5 w-3.5 md:h-4 md:w-4 ml-1" />المصادقة</TabsTrigger>
              <TabsTrigger value="tranzila" className="text-xs md:text-sm px-2 md:px-3"><CreditCard className="h-3.5 w-3.5 md:h-4 md:w-4 ml-1" />Tranzila</TabsTrigger>
              <TabsTrigger value="features" className="text-xs md:text-sm px-2 md:px-3"><Settings className="h-3.5 w-3.5 md:h-4 md:w-4 ml-1" />الميزات</TabsTrigger>
              <TabsTrigger value="payments" className="text-xs md:text-sm px-2 md:px-3"><CreditCard className="h-3.5 w-3.5 md:h-4 md:w-4 ml-1" />المدفوعات</TabsTrigger>
              <TabsTrigger value="import" className="text-xs md:text-sm px-2 md:px-3"><Upload className="h-3.5 w-3.5 md:h-4 md:w-4 ml-1" />استيراد بيانات</TabsTrigger>
              <TabsTrigger value="stats" className="text-xs md:text-sm px-2 md:px-3"><Building2 className="h-3.5 w-3.5 md:h-4 md:w-4 ml-1" />إحصائيات</TabsTrigger>
            </TabsList>
          </div>

          {/* ═══════════ INFO TAB ═══════════ */}
          <TabsContent value="info">
            <Card>
              <CardHeader>
                <CardTitle>بيانات الوكيل</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><Label>الاسم (English)</Label><Input value={agent.name} onChange={e => setAgent({...agent, name: e.target.value})} /></div>
                  <div><Label>الاسم (عربي)</Label><Input value={agent.name_ar || ''} onChange={e => setAgent({...agent, name_ar: e.target.value})} /></div>
                  <div><Label>الإيميل</Label><Input value={agent.email} onChange={e => setAgent({...agent, email: e.target.value})} /></div>
                  <div><Label>الهاتف</Label><Input value={agent.phone || ''} onChange={e => setAgent({...agent, phone: e.target.value})} /></div>
                  <div>
                    <Label>الخطة</Label>
                    <Select value={agent.plan} onValueChange={v => {
                      const plan = dbPlans.find(p => p.plan_key === v);
                      setAgent({...agent, plan: v, monthly_price: plan?.monthly_price ?? agent.monthly_price});
                    }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {dbPlans.length > 0 ? dbPlans.map(p => (
                          <SelectItem key={p.plan_key} value={p.plan_key}>
                            {p.name} — ₪{p.monthly_price}/شهر
                          </SelectItem>
                        )) : (
                          <>
                            <SelectItem value="basic">Basic — ₪300/شهر</SelectItem>
                            <SelectItem value="pro">Pro — ₪500/شهر</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>حالة الاشتراك</Label>
                    <Select value={agent.subscription_status} onValueChange={v => setAgent({...agent, subscription_status: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="trial">تجربة مجانية</SelectItem>
                        <SelectItem value="active">فعال</SelectItem>
                        <SelectItem value="paused">متوقف مؤقتاً</SelectItem>
                        <SelectItem value="suspended">معلّق</SelectItem>
                        <SelectItem value="expired">منتهي</SelectItem>
                        <SelectItem value="cancelled">ملغي</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>تاريخ انتهاء الاشتراك</Label>
                    <Input 
                      type="date"
                      value={agent.subscription_expires_at ? format(new Date(agent.subscription_expires_at), 'yyyy-MM-dd') : ''} 
                      onChange={e => setAgent({...agent, subscription_expires_at: e.target.value ? new Date(e.target.value).toISOString() : null})}
                    />
                  </div>
                  <div>
                    <Label>السعر الشهري</Label>
                    <Input type="number" value={agent.monthly_price || ''} onChange={e => setAgent({...agent, monthly_price: parseFloat(e.target.value) || null})} />
                  </div>
                </div>
                <div><Label>ملاحظات</Label><Textarea value={agent.notes || ''} onChange={e => setAgent({...agent, notes: e.target.value})} /></div>
                <div className="flex gap-3 pt-2">
                  <Button onClick={saveAgent} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                    حفظ التغييرات
                  </Button>
                  <Button variant="outline" onClick={extendSubscription}>تمديد شهر واحد</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════ USERS TAB ═══════════ */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle>مستخدمو الوكيل</CardTitle>
                <CardDescription>إنشاء مستخدمين وتحديد صلاحياتهم وفروعهم</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Create user form */}
                <div className="p-4 border rounded-lg bg-muted/30 space-y-4">
                  <h3 className="font-semibold flex items-center gap-2"><UserPlus className="h-4 w-4" />إنشاء مستخدم جديد</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>الاسم الكامل</Label>
                      <Input value={newUserName} onChange={e => setNewUserName(e.target.value)} placeholder="مثال: أحمد محمد" />
                    </div>
                    <div>
                      <Label>البريد الإلكتروني *</Label>
                      <Input value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} placeholder="user@example.com" dir="ltr" type="email" />
                    </div>
                    <div>
                      <Label>كلمة المرور *</Label>
                      <Input value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} placeholder="6 أحرف على الأقل" dir="ltr" type="password" />
                    </div>
                    <div>
                      <Label>الهاتف</Label>
                      <Input value={newUserPhone} onChange={e => setNewUserPhone(e.target.value)} placeholder="05XXXXXXXX" dir="ltr" />
                    </div>
                    <div>
                      <Label>الصلاحية *</Label>
                      <Select value={newUserRole} onValueChange={(v) => setNewUserRole(v as 'admin' | 'worker')}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">مدير (Admin)</SelectItem>
                          <SelectItem value="worker">موظف (Worker)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {branches.length > 0 && (
                      <div>
                        <Label>الفرع</Label>
                        <Select value={newUserBranch} onValueChange={setNewUserBranch}>
                          <SelectTrigger><SelectValue placeholder="بدون فرع" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">بدون فرع</SelectItem>
                            {branches.map((b: any) => (
                              <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <Button onClick={createUserForAgent} disabled={creatingUser || !newUserEmail.trim() || !newUserPassword.trim()}>
                    {creatingUser ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Plus className="h-4 w-4 ml-2" />}
                    إنشاء المستخدم
                  </Button>
                </div>

                {/* Users table */}
                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">المستخدم</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">الإيميل</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap hidden md:table-cell">الهاتف</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">الصلاحية</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap hidden md:table-cell">الفرع</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">الحالة</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">البريد</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agentUsers.map((au: any) => {
                        const p = au.profiles;
                        const role = userRoles[au.user_id];
                        const branchName = p?.branch_id ? branches.find((b: any) => b.id === p.branch_id) : null;
                        return (
                          <tr key={au.id} className="border-t">
                            <td className="p-2 md:p-3 font-medium text-xs md:text-sm">{p?.full_name || '—'}</td>
                            <td className="p-2 md:p-3 text-muted-foreground text-xs md:text-sm truncate max-w-[120px] md:max-w-none">{p?.email || '—'}</td>
                            <td className="p-2 md:p-3 text-muted-foreground text-xs md:text-sm hidden md:table-cell">{p?.phone || '—'}</td>
                            <td className="p-2 md:p-3">
                              <Select value={role || 'worker'} onValueChange={(v) => changeUserRole(au.user_id, v as 'admin' | 'worker')}>
                                <SelectTrigger className="h-7 md:h-8 w-20 md:w-28 text-xs md:text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">مدير</SelectItem>
                                  <SelectItem value="worker">موظف</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="p-2 md:p-3 text-muted-foreground text-xs hidden md:table-cell">
                              {branchName ? (branchName.name_ar || branchName.name) : '—'}
                            </td>
                            <td className="p-2 md:p-3">
                              <Badge variant={p?.status === 'active' ? 'default' : 'secondary'} className="text-[10px] md:text-xs">{p?.status === 'active' ? 'فعال' : p?.status || '—'}</Badge>
                            </td>
                            <td className="p-2 md:p-3">
                              {p?.email_confirmed ? (
                                <Badge variant="default" className="text-[10px] md:text-xs bg-green-600">مفعّل</Badge>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <Badge variant="destructive" className="text-[10px] md:text-xs">غير مفعّل</Badge>
                                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2"
                                    onClick={async () => {
                                      const { error } = await supabase.from('profiles').update({ email_confirmed: true }).eq('id', au.user_id);
                                      if (error) { toast.error('فشل في التفعيل'); return; }
                                      // Also confirm in auth
                                      await supabase.functions.invoke('update-user-password', { body: { user_id: au.user_id, confirm_email: true } });
                                      toast.success('تم تفعيل البريد');
                                      fetchAll();
                                    }}>تفعيل</Button>
                                </div>
                              )}
                            </td>
                            <td className="p-2 md:p-3">
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditUser(au)}>
                                  <Settings className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" className="text-destructive h-7 w-7 p-0" onClick={() => removeUserFromAgent(au.user_id)}>
                                  <UserMinus className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {agentUsers.length === 0 && (
                        <tr><td colSpan={8} className="p-6 text-center text-muted-foreground text-sm">لا يوجد مستخدمون</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════ BRANDING TAB ═══════════ */}
          <TabsContent value="branding">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" />العلامة التجارية</CardTitle>
                <CardDescription>الشعار واسم الموقع والوصف</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><Label>اسم الموقع</Label><Input value={initSite().site_title} onChange={e => setSiteSettings({...initSite(), ...siteSettings, site_title: e.target.value})} placeholder="مثال: Thiqa للتأمين" /></div>
                  <div><Label>وصف الموقع</Label><Input value={initSite().site_description} onChange={e => setSiteSettings({...initSite(), ...siteSettings, site_description: e.target.value})} /></div>
                  <div><Label>رابط الشعار (Logo URL)</Label><Input value={initSite().logo_url || ''} onChange={e => setSiteSettings({...initSite(), ...siteSettings, logo_url: e.target.value || null})} placeholder="https://cdn.example.com/logo.png" dir="ltr" /></div>
                  <div><Label>رابط Favicon</Label><Input value={initSite().favicon_url || ''} onChange={e => setSiteSettings({...initSite(), ...siteSettings, favicon_url: e.target.value || null})} placeholder="https://cdn.example.com/favicon.ico" dir="ltr" /></div>
                </div>
                {initSite().logo_url && (
                  <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                    <img src={initSite().logo_url} alt="Logo" className="h-14 w-auto rounded object-contain" />
                    <span className="text-sm text-muted-foreground">الشعار الحالي</span>
                  </div>
                )}
                <Button onClick={saveSiteSettings} disabled={savingSection === 'site'}>
                  {savingSection === 'site' ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                  حفظ العلامة التجارية
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════ SMS 019 TAB ═══════════ */}
          <TabsContent value="sms">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" />إعدادات SMS — 019</CardTitle>
                <CardDescription>بيانات حساب 019 لإرسال الرسائل النصية</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Switch checked={initSms().is_enabled} onCheckedChange={v => setSmsSettings({...initSms(), ...smsSettings, is_enabled: v})} />
                  <Label>تفعيل SMS</Label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div><Label>اسم المستخدم (019)</Label><Input value={initSms().sms_user} onChange={e => setSmsSettings({...initSms(), ...smsSettings, sms_user: e.target.value})} dir="ltr" /></div>
                  <div>
                    <Label>Token (019)</Label>
                    <div className="relative">
                      <Input type={showTokens.smsToken ? 'text' : 'password'} value={initSms().sms_token} onChange={e => setSmsSettings({...initSms(), ...smsSettings, sms_token: e.target.value})} dir="ltr" />
                      <Button variant="ghost" size="icon" className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => toggleToken('smsToken')}>
                        {showTokens.smsToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div><Label>رقم المصدر</Label><Input value={initSms().sms_source} onChange={e => setSmsSettings({...initSms(), ...smsSettings, sms_source: e.target.value})} dir="ltr" /></div>
                </div>
                <Button onClick={saveSmsSettings} disabled={savingSection === 'sms'}>
                  {savingSection === 'sms' ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                  حفظ إعدادات SMS
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════ AUTH TAB ═══════════ */}
          <TabsContent value="auth">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Email OTP (SMTP)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch checked={initAuth().email_otp_enabled} onCheckedChange={v => setAuthSettings({...initAuth(), ...authSettings, email_otp_enabled: v})} />
                    <Label>تفعيل تسجيل الدخول بالإيميل</Label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><Label>SMTP Host</Label><Input value={initAuth().smtp_host || ''} onChange={e => setAuthSettings({...initAuth(), ...authSettings, smtp_host: e.target.value})} dir="ltr" /></div>
                    <div><Label>SMTP Port</Label><Input type="number" value={initAuth().smtp_port || 465} onChange={e => setAuthSettings({...initAuth(), ...authSettings, smtp_port: parseInt(e.target.value)})} /></div>
                    <div><Label>SMTP User</Label><Input value={initAuth().smtp_user || ''} onChange={e => setAuthSettings({...initAuth(), ...authSettings, smtp_user: e.target.value})} dir="ltr" /></div>
                    <div>
                      <Label>SMTP Password</Label>
                      <div className="relative">
                        <Input type={showTokens.smtp ? 'text' : 'password'} value={initAuth().smtp_password || ''} onChange={e => setAuthSettings({...initAuth(), ...authSettings, smtp_password: e.target.value})} dir="ltr" />
                        <Button variant="ghost" size="icon" className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => toggleToken('smtp')}>
                          {showTokens.smtp ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Phone className="h-5 w-5" />IPPBX / Click2Call</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch checked={initAuth().ippbx_enabled ?? false} onCheckedChange={v => setAuthSettings({...initAuth(), ...authSettings, ippbx_enabled: v})} />
                    <Label>تفعيل Click2Call</Label>
                  </div>
                  <div><Label>IPPBX Token ID</Label><Input value={initAuth().ippbx_token_id || ''} onChange={e => setAuthSettings({...initAuth(), ...authSettings, ippbx_token_id: e.target.value})} dir="ltr" /></div>
                </CardContent>
              </Card>
              <Button onClick={saveAuthSettings} disabled={savingSection === 'auth'}>
                {savingSection === 'auth' ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                حفظ إعدادات المصادقة
              </Button>
            </div>
          </TabsContent>

          {/* ═══════════ TRANZILA TAB ═══════════ */}
          <TabsContent value="tranzila">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" />إعدادات Tranzila</CardTitle>
                <CardDescription>بوابة الدفع الإلكتروني</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Switch checked={initPay().is_enabled} onCheckedChange={v => setPaymentSettings({...initPay(), ...paymentSettings, is_enabled: v})} />
                  <Label>تفعيل الدفع الإلكتروني</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={initPay().test_mode} onCheckedChange={v => setPaymentSettings({...initPay(), ...paymentSettings, test_mode: v})} />
                  <Label>وضع الاختبار (Sandbox)</Label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><Label>Terminal Name</Label><Input value={initPay().terminal_name || ''} onChange={e => setPaymentSettings({...initPay(), ...paymentSettings, terminal_name: e.target.value})} dir="ltr" /></div>
                  <div>
                    <Label>API Password</Label>
                    <div className="relative">
                      <Input type={showTokens.tranzila ? 'text' : 'password'} value={initPay().api_password || ''} onChange={e => setPaymentSettings({...initPay(), ...paymentSettings, api_password: e.target.value})} dir="ltr" />
                      <Button variant="ghost" size="icon" className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => toggleToken('tranzila')}>
                        {showTokens.tranzila ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div><Label>Sandbox Terminal</Label><Input value={initPay().sandbox_terminal_name || ''} onChange={e => setPaymentSettings({...initPay(), ...paymentSettings, sandbox_terminal_name: e.target.value})} dir="ltr" /></div>
                  <div><Label>Success URL</Label><Input value={initPay().success_url || ''} onChange={e => setPaymentSettings({...initPay(), ...paymentSettings, success_url: e.target.value})} dir="ltr" /></div>
                  <div><Label>Fail URL</Label><Input value={initPay().fail_url || ''} onChange={e => setPaymentSettings({...initPay(), ...paymentSettings, fail_url: e.target.value})} dir="ltr" /></div>
                  <div><Label>Notify URL (Webhook)</Label><Input value={initPay().notify_url || ''} onChange={e => setPaymentSettings({...initPay(), ...paymentSettings, notify_url: e.target.value})} dir="ltr" /></div>
                </div>
                <Button onClick={savePaymentSettings} disabled={savingSection === 'payment'}>
                  {savingSection === 'payment' ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                  حفظ إعدادات Tranzila
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════ FEATURES TAB ═══════════ */}
          <TabsContent value="features">
            <Card>
              <CardHeader>
                <CardTitle>ميزات الوكيل</CardTitle>
                <CardDescription>تحكم بالميزات المتاحة لهذا الوكيل</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {ALL_FEATURES.map(feature => {
                    const isEnabled = features[feature.key] ?? (agent.plan === 'pro');
                    return (
                      <div key={feature.key} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium text-sm">{feature.label}</div>
                          <div className="text-xs text-muted-foreground">{feature.description}</div>
                        </div>
                        <Switch checked={isEnabled} onCheckedChange={v => toggleFeature(feature.key, v)} />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

          </TabsContent>

           {/* ═══════════ PAYMENTS TAB ═══════════ */}
          <TabsContent value="payments" className="space-y-4">
            {/* Pending unbilled overages — credit top-ups the agent bought that
                haven't been rolled into an invoice yet. The admin can tick
                "include in this payment" to bundle them into the next invoice
                and mark them billed, or use the standalone button to just
                clear the pending state without recording a new payment. */}
            {unbilledOverages.length > 0 && (() => {
              const total = unbilledOverages.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
              const smsRows = unbilledOverages.filter((o) => o.usage_type === 'sms');
              const aiRows = unbilledOverages.filter((o) => o.usage_type === 'ai_chat');
              const smsCount = smsRows.reduce((s, o) => s + o.extra_count, 0);
              const smsTotal = smsRows.reduce((s, o) => s + Number(o.total_amount), 0);
              const aiCount = aiRows.reduce((s, o) => s + o.extra_count, 0);
              const aiTotal = aiRows.reduce((s, o) => s + Number(o.total_amount), 0);
              return (
                <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-amber-600" />
                        <span>إضافات غير مفوترة ({unbilledOverages.length})</span>
                      </div>
                      <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-sm">
                        ₪{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      شحنات الرصيد التي اشتراها الوكيل ولم تُدرج بعد في أي فاتورة. شمّلها في
                      الدفعة التالية أو اضغط "تسوية" لتحديدها كمفوترة بدون دفعة.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {smsCount > 0 && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-background border">
                        <div>
                          <p className="text-sm font-semibold">رسائل SMS إضافية</p>
                          <p className="text-xs text-muted-foreground">
                            {smsCount.toLocaleString()} رسالة عبر {smsRows.length} عملية شراء
                          </p>
                        </div>
                        <span className="text-base font-bold tabular-nums">
                          ₪{smsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                    {aiCount > 0 && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-background border">
                        <div>
                          <p className="text-sm font-semibold">محادثات المساعد الذكي إضافية</p>
                          <p className="text-xs text-muted-foreground">
                            {aiCount.toLocaleString()} محادثة عبر {aiRows.length} عملية شراء
                          </p>
                        </div>
                        <span className="text-base font-bold tabular-nums">
                          ₪{aiTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}

                    {/* Per-purchase details */}
                    <details className="rounded-lg border bg-background">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
                        تفاصيل كل عملية شراء
                      </summary>
                      <div className="border-t divide-y text-xs">
                        {unbilledOverages.map((o) => (
                          <div key={o.id} className="flex items-center justify-between px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                +{o.extra_count} {o.usage_type === 'sms' ? 'رسالة' : 'محادثة'}
                              </span>
                              <span className="text-muted-foreground">
                                ({format(new Date(o.created_at), 'dd/MM/yyyy')})
                              </span>
                            </div>
                            <span className="tabular-nums text-muted-foreground">
                              {o.extra_count} × ₪{Number(o.unit_price).toFixed(2)} =
                              <span className="text-foreground font-semibold mr-1">
                                ₪{Number(o.total_amount).toFixed(2)}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>

                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const base = parseFloat(paymentAmount) || (agent.monthly_price || 0);
                          setPaymentAmount((base + total).toFixed(2));
                          setIncludeOveragesInPayment(true);
                          toast.success("تم إضافة المبلغ إلى الدفعة — اضغط تسجيل الدفعة لإتمامها");
                        }}
                      >
                        تضمين في الدفعة التالية
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={markOveragesAsBilled}
                      >
                        تسوية بدون دفعة
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" />سجل المدفوعات</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                  <div>
                    <Label>المبلغ (₪)</Label>
                    <Input type="number" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder={`${agent.monthly_price || 300}`} />
                  </div>
                  <div>
                    <Label>من تاريخ</Label>
                    <DateInputPicker value={periodStart} onChange={handlePeriodStartChange} />
                  </div>
                  <div>
                    <Label>إلى تاريخ</Label>
                    <DateInputPicker value={periodEnd} onChange={setPeriodEnd} />
                  </div>
                  <div>
                    <Label>ملاحظات</Label>
                    <Input value={paymentNotes} onChange={e => setPaymentNotes(e.target.value)} placeholder="اختياري" />
                  </div>
                  <Button onClick={recordPayment} disabled={!paymentAmount} className="w-full text-xs md:text-sm whitespace-nowrap">تسجيل الدفعة</Button>
                </div>

                {/* Checkbox to also mark unbilled overages as billed when saving */}
                {unbilledOverages.length > 0 && (
                  <label className="flex items-start gap-2 text-sm p-3 rounded-lg border border-amber-200 bg-amber-50/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeOveragesInPayment}
                      onChange={(e) => setIncludeOveragesInPayment(e.target.checked)}
                      className="mt-0.5 accent-amber-600"
                    />
                    <span>
                      تضمين الإضافات غير المفوترة في هذه الدفعة (₪
                      {unbilledOverages.reduce((s, o) => s + Number(o.total_amount), 0).toFixed(2)}) —
                      سيتم تعليمها كمفوترة عند الحفظ.
                    </span>
                  </label>
                )}

                {/* No active payment warning */}
                {payments.length > 0 && !payments.some((p: any) => p.status === 'active') && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-center">
                    <p className="text-sm font-medium text-destructive">⚠️ لا يوجد دفعة فعالة — الوكيل لم يدفع</p>
                  </div>
                )}

                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">الحالة</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">من تاريخ</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">إلى تاريخ</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">المبلغ</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">الخطة</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap">ملاحظات</th>
                        <th className="text-right p-2 md:p-3 text-xs md:text-sm whitespace-nowrap w-[80px]">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p: any) => (
                        <tr key={p.id} className="border-t">
                          <td className="p-2 md:p-3">
                            <Badge className={`text-[10px] md:text-xs ${p.status === 'active' ? 'bg-green-600' : 'bg-muted text-muted-foreground'}`}>
                              {p.status === 'active' ? 'فعالة' : 'منتهية'}
                            </Badge>
                          </td>
                          <td className="p-2 md:p-3 text-xs md:text-sm">{p.period_start ? format(new Date(p.period_start), 'dd/MM/yyyy') : format(new Date(p.payment_date), 'dd/MM/yyyy')}</td>
                          <td className="p-2 md:p-3 text-xs md:text-sm">{p.period_end ? format(new Date(p.period_end), 'dd/MM/yyyy') : '—'}</td>
                          <td className="p-2 md:p-3 font-medium text-xs md:text-sm">₪{p.amount}</td>
                          <td className="p-2 md:p-3"><Badge variant="outline" className="text-[10px] md:text-xs">{p.plan}</Badge></td>
                          <td className="p-2 md:p-3 text-muted-foreground text-xs md:text-sm">{p.notes || '—'}</td>
                          <td className="p-2 md:p-3">
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditPayment(p)}>
                                <Settings className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="sm" className="text-destructive h-7 w-7 p-0" onClick={() => setDeletePaymentId(p.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {payments.length === 0 && (
                        <tr>
                          <td colSpan={7} className="p-6 text-center text-muted-foreground text-sm">
                            لا توجد مدفوعات — الوكيل لم يسدد أي دفعة بعد
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════ IMPORT TAB ═══════════ */}
          <TabsContent value="import">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" />استيراد بيانات</CardTitle>
                <CardDescription>رفع ملف JSON يحتوي على بيانات الوكيل (نسخة احتياطية من نظام سابق)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border-2 border-dashed rounded-xl p-8 text-center space-y-4">
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                  <div>
                    <Label htmlFor="import-file" className="cursor-pointer">
                      <span className="text-primary font-medium hover:underline">اختر ملف JSON</span>
                    </Label>
                    <input
                      id="import-file"
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) { setImportFile(f); setImportResults(null); }
                      }}
                    />
                  </div>
                  {importFile && (
                    <div className="text-sm text-muted-foreground">
                      <Badge variant="secondary">{importFile.name}</Badge>
                      <span className="mr-2">({(importFile.size / 1024 / 1024).toFixed(1)} MB)</span>
                    </div>
                  )}
                </div>

                <Button
                  onClick={handleImportData}
                  disabled={!importFile || importing}
                  className="w-full"
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Upload className="h-4 w-4 ml-2" />}
                  {importing ? importProgress || "جاري الاستيراد..." : "بدء الاستيراد"}
                </Button>

                {/* Progress bar and elapsed time */}
                {importing && importTotalRows > 0 && (
                  <div className="space-y-2 rounded-xl border border-border p-4 bg-secondary/30">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {importProgress && <span className="font-medium text-foreground">{importProgress}</span>}
                      </span>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>⏱ {Math.floor(importElapsed / 60).toString().padStart(2, '0')}:{(importElapsed % 60).toString().padStart(2, '0')}</span>
                        <span>{importDoneRows.toLocaleString()} / {importTotalRows.toLocaleString()} سجل</span>
                      </div>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-primary h-full rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${Math.min(100, (importDoneRows / importTotalRows) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground text-center">
                      {Math.round((importDoneRows / importTotalRows) * 100)}% — يتم الاستيراد جدول بجدول لتجنّب انتهاء المهلة
                    </p>
                  </div>
                )}

                {importResults && (
                  <Card className="mt-4">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center justify-between">
                        <span>نتائج الاستيراد</span>
                        {!importing && importElapsed > 0 && (
                          <span className="text-xs text-muted-foreground font-normal">
                            اكتمل في {Math.floor(importElapsed / 60)}:{(importElapsed % 60).toString().padStart(2, '0')} دقيقة
                          </span>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-right p-2 font-medium">الجدول</th>
                              <th className="text-right p-2 font-medium">عدد السجلات</th>
                              <th className="text-right p-2 font-medium">تم الإدراج</th>
                              <th className="text-right p-2 font-medium">أخطاء</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(importResults).map(([table, res]) => (
                              <tr key={table} className="border-b last:border-0">
                                <td className="p-2 text-xs">
                                  <span className="font-medium">{TABLE_LABELS[table] || table}</span>
                                  <span className="text-muted-foreground mr-1 font-mono text-[10px]">({table})</span>
                                </td>
                                <td className="p-2 text-muted-foreground text-xs">{(res.inserted + res.errors).toLocaleString()}</td>
                                <td className="p-2">
                                  <Badge variant={res.inserted > 0 ? "default" : "secondary"}>{res.inserted.toLocaleString()}</Badge>
                                </td>
                                <td className="p-2">
                                  {res.errors > 0 ? (
                                    <Badge variant="destructive">{res.errors.toLocaleString()}</Badge>
                                  ) : (
                                    <span className="text-muted-foreground">0</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════ STATS TAB ═══════════ */}
          <TabsContent value="stats">
            {/* Usage Limits */}
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>حدود الاستخدام</CardTitle>
                <CardDescription>تحديد عدد الرسائل النصية ومحادثات الذكاء الاصطناعي المسموح بها</CardDescription>
              </CardHeader>
              <CardContent>
                <UsageLimitsEditor agentId={agentId!} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />إحصائيات الوكيل</CardTitle>
                <CardDescription>عدد العملاء والسيارات والوثائق المسجلة</CardDescription>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[1,2,3].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
                  </div>
                ) : agentStats ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="border-2 text-center p-6">
                      <Users className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <p className="text-3xl font-bold">{agentStats.clients.toLocaleString()}</p>
                      <p className="text-sm text-muted-foreground mt-1">عملاء</p>
                    </Card>
                    <Card className="border-2 text-center p-6">
                      <Building2 className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <p className="text-3xl font-bold">{agentStats.cars.toLocaleString()}</p>
                      <p className="text-sm text-muted-foreground mt-1">سيارات</p>
                    </Card>
                    <Card className="border-2 text-center p-6">
                      <Shield className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <p className="text-3xl font-bold">{agentStats.policies.toLocaleString()}</p>
                      <p className="text-sm text-muted-foreground mt-1">وثائق تأمين</p>
                    </Card>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">لا توجد بيانات</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete Agent Dialog */}
      <DeleteConfirmDialog
        open={deleteAgentOpen}
        onOpenChange={setDeleteAgentOpen}
        onConfirm={deleteAgent}
        title="حذف الوكيل"
        description={`هل أنت متأكد من حذف الوكيل "${agent.name_ar || agent.name}"؟ سيتم حذف جميع بياناته بشكل نهائي.`}
        loading={deletingAgent}
      />

      {/* Delete Payment Dialog */}
      <DeleteConfirmDialog
        open={!!deletePaymentId}
        onOpenChange={(open) => !open && setDeletePaymentId(null)}
        onConfirm={() => deletePaymentId && deletePayment(deletePaymentId)}
        title="حذف الدفعة"
        description="هل أنت متأكد من حذف هذه الدفعة؟ لا يمكن التراجع عن هذا الإجراء."
      />

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل المستخدم</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>الاسم الكامل</Label>
              <Input value={editUserName} onChange={e => setEditUserName(e.target.value)} placeholder="الاسم" />
            </div>
            <div className="space-y-2">
              <Label>الهاتف</Label>
              <Input value={editUserPhone} onChange={e => setEditUserPhone(e.target.value)} placeholder="05XXXXXXXX" dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label>الفرع</Label>
              <Select value={editUserBranch} onValueChange={setEditUserBranch}>
                <SelectTrigger><SelectValue placeholder="بدون فرع" /></SelectTrigger>
                <SelectContent>
                   <SelectItem value="none">بدون فرع</SelectItem>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name_ar || b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>كلمة مرور جديدة</Label>
              <Input
                type="password"
                value={editUserPassword}
                onChange={e => setEditUserPassword(e.target.value)}
                placeholder="اتركه فارغاً للإبقاء على الحالي"
                dir="ltr"
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">6 أحرف على الأقل</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditingUser(null)}>إلغاء</Button>
            <Button onClick={saveEditUser} disabled={savingUser}>
              {savingUser && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Payment Dialog */}
      <Dialog open={!!editingPayment} onOpenChange={(open) => !open && setEditingPayment(null)}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل الدفعة</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>المبلغ (₪)</Label>
              <Input type="number" value={editPaymentAmount} onChange={e => setEditPaymentAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>من تاريخ</Label>
              <DateInputPicker value={editPeriodStart} onChange={handleEditPeriodStartChange} />
            </div>
            <div className="space-y-2">
              <Label>إلى تاريخ</Label>
              <DateInputPicker value={editPeriodEnd} onChange={setEditPeriodEnd} />
            </div>
            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Input value={editPaymentNotes} onChange={e => setEditPaymentNotes(e.target.value)} placeholder="اختياري" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditingPayment(null)}>إلغاء</Button>
            <Button onClick={saveEditPayment} disabled={savingPayment}>
              {savingPayment && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
