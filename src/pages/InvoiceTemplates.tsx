import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Plus, Edit, Trash2, Eye, Copy, FileText, Loader2, Palette, Code } from "lucide-react";
import { InvoiceVisualBuilder, TemplateElement } from "@/components/invoices/InvoiceVisualBuilder";

interface InvoiceTemplate {
  id: string;
  name: string;
  language: string;
  direction: string;
  logo_url: string | null;
  header_html: string | null;
  body_html: string | null;
  footer_html: string | null;
  template_layout_json: TemplateElement[] | null;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

interface PreviewPolicy {
  id: string;
  insurance_price: number;
  policy_type_parent: string;
  start_date: string;
  end_date: string;
  client: { full_name: string; id_number: string; phone_number: string | null } | null;
  car: { car_number: string } | null;
  company: { name: string; name_ar: string | null } | null;
}

export default function InvoiceTemplates() {
  const { toast } = useToast();
  const { isAdmin, user } = useAuth();
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<InvoiceTemplate | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [policies, setPolicies] = useState<PreviewPolicy[]>([]);
  const [selectedPreviewPolicy, setSelectedPreviewPolicy] = useState<string>('');
  const [previewData, setPreviewData] = useState<Record<string, string>>({});

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    language: 'ar',
    direction: 'rtl',
    logo_url: '',
    header_html: '',
    body_html: '',
    footer_html: '',
    template_layout_json: [] as TemplateElement[],
    is_active: false,
  });

  useEffect(() => {
    fetchTemplates();
    fetchPolicies();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('invoice_templates')
      .select('*')
      .order('language', { ascending: true })
      .order('is_active', { ascending: false });

    setLoading(false);
    if (error) {
      toast({ title: "خطأ", description: "فشل في تحميل القوالب", variant: "destructive" });
      return;
    }
    setTemplates((data || []).map((t: any) => ({
      ...t,
      template_layout_json: Array.isArray(t.template_layout_json)
        ? (t.template_layout_json as unknown as TemplateElement[])
        : [],
    })));
  };

  const fetchPolicies = async () => {
    const { data } = await supabase
      .from('policies')
      .select(`
        id, insurance_price, policy_type_parent, start_date, end_date,
        client:clients(full_name, id_number, phone_number),
        car:cars(car_number),
        company:insurance_companies(name, name_ar)
      `)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20);

    if (data) {
      setPolicies(data as any);
    }
  };

  useEffect(() => {
    if (selectedPreviewPolicy) {
      const policy = policies.find(p => p.id === selectedPreviewPolicy);
      if (policy) {
        setPreviewData({
          invoice_number: '2024-000001',
          issue_date: new Date().toLocaleDateString(formData.language === 'ar' ? 'ar-SA' : 'he-IL'),
          client_name: policy.client?.full_name || '',
          client_id_number: policy.client?.id_number || '',
          client_phone: policy.client?.phone_number || '',
          car_number: policy.car?.car_number || '',
          company_name: formData.language === 'ar' ? (policy.company?.name_ar || policy.company?.name || '') : (policy.company?.name || ''),
          insurance_type: policy.policy_type_parent || '',
          start_date: policy.start_date || '',
          end_date: policy.end_date || '',
          total_amount: policy.insurance_price?.toLocaleString() || '0',
          payment_method: formData.language === 'ar' ? 'نقدي' : 'מזומן',
          admin_name: user?.email?.split('@')[0] || '',
          policy_number: `${policy.policy_type_parent} ${new Date(policy.start_date).getFullYear()} ${policy.car?.car_number || ''}`,
        });
      }
    }
  }, [selectedPreviewPolicy, policies, formData.language]);

  const handleEdit = (template: InvoiceTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      language: template.language,
      direction: template.direction,
      logo_url: template.logo_url || '',
      header_html: template.header_html || '',
      body_html: template.body_html || '',
      footer_html: template.footer_html || '',
      template_layout_json: template.template_layout_json || [],
      is_active: template.is_active,
    });
    setShowEditor(true);
  };

  const handleCreate = () => {
    setEditingTemplate(null);
    setFormData({
      name: '',
      language: 'ar',
      direction: 'rtl',
      logo_url: '',
      header_html: '',
      body_html: '',
      footer_html: '',
      template_layout_json: [],
      is_active: false,
    });
    setShowEditor(true);
  };

  const handleDuplicate = async (template: InvoiceTemplate) => {
    const { error } = await supabase
      .from('invoice_templates')
      .insert({
        name: `${template.name} (نسخة)`,
        language: template.language as any,
        direction: template.direction as any,
        logo_url: template.logo_url,
        header_html: template.header_html,
        body_html: template.body_html,
        footer_html: template.footer_html,
        template_layout_json: template.template_layout_json as any,
        is_active: false,
        created_by_admin_id: user?.id,
      });

    if (error) {
      toast({ title: "خطأ", description: "فشل في نسخ القالب", variant: "destructive" });
      return;
    }

    toast({ title: "تم النسخ", description: "تم نسخ القالب بنجاح" });
    fetchTemplates();
  };

  const handleSetActive = async (template: InvoiceTemplate) => {
    // First deactivate all templates of the same language
    await supabase
      .from('invoice_templates')
      .update({ is_active: false })
      .eq('language', template.language);

    // Then activate this one
    const { error } = await supabase
      .from('invoice_templates')
      .update({ is_active: true })
      .eq('id', template.id);

    if (error) {
      toast({ title: "خطأ", description: "فشل في تفعيل القالب", variant: "destructive" });
      return;
    }

    toast({ title: "تم التفعيل", description: "تم تعيين هذا القالب كنشط" });
    fetchTemplates();
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({ title: "خطأ", description: "الرجاء إدخال اسم القالب", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      if (editingTemplate) {
        const { error } = await supabase
          .from('invoice_templates')
          .update({
            name: formData.name.trim(),
            language: formData.language as any,
            direction: formData.direction as any,
            logo_url: formData.logo_url.trim() || null,
            header_html: formData.header_html,
            body_html: formData.body_html,
            footer_html: formData.footer_html,
            template_layout_json: formData.template_layout_json as any,
            is_active: formData.is_active,
            version: editingTemplate.version + 1,
          })
          .eq('id', editingTemplate.id);

        if (error) throw error;
        toast({ title: "تم الحفظ", description: `تم تحديث القالب (النسخة ${editingTemplate.version + 1})` });
      } else {
        const { error } = await supabase
          .from('invoice_templates')
          .insert({
            name: formData.name.trim(),
            language: formData.language as any,
            direction: formData.direction as any,
            logo_url: formData.logo_url.trim() || null,
            header_html: formData.header_html,
            body_html: formData.body_html,
            footer_html: formData.footer_html,
            template_layout_json: formData.template_layout_json as any,
            is_active: formData.is_active,
            created_by_admin_id: user?.id,
          });

        if (error) throw error;
        toast({ title: "تم الحفظ", description: "تم إنشاء القالب بنجاح" });
      }

      setShowEditor(false);
      fetchTemplates();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message || "فشل في حفظ القالب", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template: InvoiceTemplate) => {
    if (!confirm('هل أنت متأكد من حذف هذا القالب؟')) return;

    const { error } = await supabase
      .from('invoice_templates')
      .delete()
      .eq('id', template.id);

    if (error) {
      toast({ title: "خطأ", description: "فشل في حذف القالب", variant: "destructive" });
      return;
    }

    toast({ title: "تم الحذف", description: "تم حذف القالب بنجاح" });
    fetchTemplates();
  };

  if (!isAdmin) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">فقط المديرين يمكنهم الوصول لهذه الصفحة</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">قوالب الفواتير</h1>
            <p className="text-muted-foreground">إدارة قوالب سندات القبض بالسحب والإفلات</p>
          </div>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 ml-2" />
            قالب جديد
          </Button>
        </div>

        {/* Templates Table */}
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الاسم</TableHead>
                  <TableHead className="text-right">اللغة</TableHead>
                  <TableHead className="text-right">النسخة</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">آخر تحديث</TableHead>
                  <TableHead className="text-right">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : templates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      لا توجد قوالب. أنشئ قالبك الأول.
                    </TableCell>
                  </TableRow>
                ) : (
                  templates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell className="font-medium">{template.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {template.language === 'ar' ? 'عربي' : template.language === 'he' ? 'עברית' : 'كلاهما'}
                        </Badge>
                      </TableCell>
                      <TableCell>v{template.version}</TableCell>
                      <TableCell>
                        {template.is_active ? (
                          <Badge className="bg-green-100 text-green-800">نشط</Badge>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => handleSetActive(template)}>
                            تعيين كنشط
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(template.updated_at).toLocaleDateString('en-GB')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(template)} title="تعديل">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDuplicate(template)} title="نسخ">
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(template)} title="حذف">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      {/* Editor Dialog - Full Screen */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-w-[95vw] w-[95vw] max-h-[95vh] h-[95vh] overflow-hidden p-0" dir="rtl">
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-4">
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {editingTemplate ? `تعديل: ${editingTemplate.name}` : 'قالب جديد'}
                </DialogTitle>
                <div className="flex items-center gap-2">
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="اسم القالب"
                    className="w-48 h-8"
                  />
                  <Select value={formData.language} onValueChange={(v) => setFormData({ ...formData, language: v })}>
                    <SelectTrigger className="w-24 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ar">عربي</SelectItem>
                      <SelectItem value="he">עברית</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 ml-4">
                  <Label className="text-sm">معاينة مع:</Label>
                  <Select value={selectedPreviewPolicy} onValueChange={setSelectedPreviewPolicy}>
                    <SelectTrigger className="w-48 h-8">
                      <SelectValue placeholder="اختر معاملة للمعاينة" />
                    </SelectTrigger>
                    <SelectContent>
                      {policies.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.client?.full_name} - {p.car?.car_number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(c) => setFormData({ ...formData, is_active: c })}
                    id="active-toggle"
                  />
                  <Label htmlFor="active-toggle" className="text-sm">نشط</Label>
                </div>
                <Button variant="outline" onClick={() => setShowEditor(false)}>
                  إلغاء
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
                  حفظ
                </Button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              <Tabs defaultValue="visual" className="h-full flex flex-col" dir="rtl">
                <div className="px-4 border-b">
                  <TabsList className="grid w-64 grid-cols-2">
                    <TabsTrigger value="visual" className="flex items-center gap-2">
                      <Palette className="h-4 w-4" />
                      تصميم بصري
                    </TabsTrigger>
                    <TabsTrigger value="code" className="flex items-center gap-2">
                      <Code className="h-4 w-4" />
                      HTML
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="visual" className="flex-1 p-4 overflow-auto mt-0">
                  <InvoiceVisualBuilder
                    layoutJson={formData.template_layout_json}
                    onChange={(layout) => setFormData({ ...formData, template_layout_json: layout })}
                    language={formData.language}
                    previewData={previewData}
                    logoUrl={formData.logo_url}
                  />
                </TabsContent>

                <TabsContent value="code" className="flex-1 p-4 overflow-auto mt-0">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-4">
                      <div>
                        <Label>رابط الشعار</Label>
                        <Input
                          value={formData.logo_url}
                          onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                          placeholder="https://..."
                          className="ltr-input"
                        />
                      </div>
                      <div>
                        <Label>الرأس (HTML)</Label>
                        <Textarea
                          value={formData.header_html}
                          onChange={(e) => setFormData({ ...formData, header_html: e.target.value })}
                          rows={6}
                          className="font-mono text-sm ltr-input"
                        />
                      </div>
                      <div>
                        <Label>المحتوى (HTML)</Label>
                        <Textarea
                          value={formData.body_html}
                          onChange={(e) => setFormData({ ...formData, body_html: e.target.value })}
                          rows={10}
                          className="font-mono text-sm ltr-input"
                        />
                      </div>
                      <div>
                        <Label>التذييل (HTML)</Label>
                        <Textarea
                          value={formData.footer_html}
                          onChange={(e) => setFormData({ ...formData, footer_html: e.target.value })}
                          rows={4}
                          className="font-mono text-sm ltr-input"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>الرموز المتاحة</Label>
                      <div className="bg-muted p-4 rounded-lg mt-2 text-sm font-mono space-y-1">
                        <p>{"{{invoice_number}}"} - رقم الفاتورة</p>
                        <p>{"{{issue_date}}"} - تاريخ الإصدار</p>
                        <p>{"{{client_name}}"} - اسم العميل</p>
                        <p>{"{{client_id_number}}"} - رقم الهوية</p>
                        <p>{"{{client_phone}}"} - الهاتف</p>
                        <p>{"{{car_number}}"} - رقم السيارة</p>
                        <p>{"{{insurance_type}}"} - نوع التأمين</p>
                        <p>{"{{company_name}}"} - شركة التأمين</p>
                        <p>{"{{start_date}}"} - تاريخ البداية</p>
                        <p>{"{{end_date}}"} - تاريخ الانتهاء</p>
                        <p>{"{{total_amount}}"} - المبلغ</p>
                        <p>{"{{payment_method}}"} - طريقة الدفع</p>
                        <p>{"{{admin_name}}"} - اسم الموظف</p>
                        <p>{"{{policy_number}}"} - رقم المعاملة</p>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
