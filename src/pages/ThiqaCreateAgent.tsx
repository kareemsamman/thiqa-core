import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Loader2, Building2, CheckCircle2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_BASIC_FEATURES = ['sms', 'financial_reports', 'broker_wallet', 'company_settlement', 'expenses', 'cheques', 'marketing_sms'];
const BLOCKED_BASIC = new Set(['sms', 'financial_reports', 'broker_wallet', 'company_settlement', 'expenses', 'cheques', 'marketing_sms']);

export default function ThiqaCreateAgent() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', name_ar: '', email: '', phone: '', plan: 'free_trial', notes: '',
  });

  const handleSubmit = async () => {
    if (!form.name || !form.email) {
      toast.error('الاسم والإيميل مطلوبان');
      return;
    }
    setSaving(true);

    // 1. Create agent
    const { data: agent, error } = await supabase
      .from('agents')
      .insert({
        name: form.name, name_ar: form.name_ar || null,
        email: form.email, phone: form.phone || null,
        plan: form.plan === 'free_trial' ? 'pro' : form.plan,
        monthly_price: form.plan === 'free_trial' ? 0 : form.plan === 'pro' ? 500 : 300,
        subscription_status: 'active',
        subscription_expires_at: new Date(Date.now() + (form.plan === 'free_trial' ? 35 : 30) * 24 * 60 * 60 * 1000).toISOString(),
        notes: form.notes || null,
      })
      .select().single();

    if (error || !agent) {
      setSaving(false);
      toast.error(`خطأ: ${error?.message || 'فشل الإنشاء'}`);
      return;
    }

    // 2. Initialize settings tables for this agent
    const agentId = agent.id;
    await Promise.all([
      supabase.from('sms_settings').insert({
        agent_id: agentId, provider: '019', sms_user: '', sms_token: '', sms_source: '', is_enabled: false,
      }),
      supabase.from('auth_settings').insert({
        agent_id: agentId, email_otp_enabled: false, sms_otp_enabled: false,
      }),
      supabase.from('payment_settings').insert({
        agent_id: agentId, provider: 'tranzila', is_enabled: false, test_mode: true,
      }),
      supabase.from('site_settings').insert({
        agent_id: agentId, site_title: form.name_ar || form.name, site_description: 'نظام إدارة التأمين',
      }),
    ]);

    // 3. Set default feature flags based on plan
    if (form.plan === 'basic') {
      const flags = DEFAULT_BASIC_FEATURES.map(key => ({
        agent_id: agentId, feature_key: key, enabled: !BLOCKED_BASIC.has(key),
      }));
      await supabase.from('agent_feature_flags').insert(flags);
    }

    setSaving(false);
    toast.success('تم إنشاء الوكيل وتهيئة إعداداته');
    navigate(`/thiqa/agents/${agentId}`);
  };

  return (
    <MainLayout>
      <div className="space-y-6 max-w-2xl px-1" dir="rtl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/thiqa/agents')}>
            <ArrowRight className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">وكيل تأمين جديد</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              بيانات الوكيل
            </CardTitle>
            <CardDescription>سيتم تهيئة جميع الإعدادات (SMS، Tranzila، العلامة التجارية) تلقائياً</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Label>الاسم (English) *</Label>
                <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Agent Name" />
              </div>
              <div>
                <Label>الاسم (عربي)</Label>
                <Input value={form.name_ar} onChange={e => setForm({...form, name_ar: e.target.value})} placeholder="اسم الوكيل" />
              </div>
              <div>
                <Label>الإيميل *</Label>
                <Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="agent@example.com" dir="ltr" />
              </div>
              <div>
                <Label>الهاتف</Label>
                <Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="05X-XXXXXXX" dir="ltr" />
              </div>
              <div className="md:col-span-2">
                <Label>الخطة</Label>
                <Select value={form.plan} onValueChange={v => setForm({...form, plan: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free_trial">
                      <div className="flex items-center gap-2">
                        تجربة مجانية — 35 يوم
                        <span className="text-xs text-muted-foreground">(كل الميزات)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="basic">
                      <div className="flex items-center gap-2">
                        Basic — ₪300/شهر
                        <span className="text-xs text-muted-foreground">(ميزات محدودة)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="pro">
                      <div className="flex items-center gap-2">
                        Pro — ₪500/شهر
                        <span className="text-xs text-muted-foreground">(كل الميزات)</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="ملاحظات إضافية..." />
            </div>

            {/* What gets created */}
            <div className="border rounded-lg p-4 bg-muted/30 space-y-2">
              <p className="font-medium text-sm">عند الإنشاء سيتم تهيئة:</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs text-muted-foreground">
                {['حساب الوكيل', 'إعدادات SMS (019)', 'إعدادات Tranzila', 'العلامة التجارية', 'إعدادات المصادقة', 'أعلام الميزات'].map(item => (
                  <div key={item} className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <Button onClick={handleSubmit} disabled={saving} className="w-full" size="lg">
              {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Building2 className="h-4 w-4 ml-2" />}
              إنشاء الوكيل وتهيئة النظام
            </Button>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
