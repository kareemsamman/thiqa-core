import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FileText, RefreshCw, Printer, Eye, Download, Plus, Loader2, ExternalLink } from "lucide-react";

interface InvoiceMetadata {
  html_content?: string;
  client_name?: string;
  total_amount?: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  language: string;
  status: string;
  issued_at: string;
  template_id: string | null;
  created_by_admin_id: string | null;
  created_by?: { full_name: string | null; email: string } | null;
  metadata_json: InvoiceMetadata | null;
  template?: {
    name: string;
  } | null;
}

interface InvoiceTemplate {
  id: string;
  name: string;
  language: string;
  is_active: boolean;
}

interface PolicyInvoicesSectionProps {
  policyId: string;
  policyTypeParent?: string;
}

export function PolicyInvoicesSection({ policyId, policyTypeParent }: PolicyInvoicesSectionProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<'ar' | 'he'>('ar');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [xInvoiceLoading] = useState(false);

  useEffect(() => {
    fetchInvoices();
    fetchTemplates();
  }, [policyId]);

  const fetchInvoices = async () => {
    setLoading(true);
const { data, error } = await supabase
      .from('invoices')
      .select(`
        *,
        template:invoice_templates(name),
        created_by:profiles!invoices_created_by_admin_id_fkey(full_name, email)
      `)
      .eq('policy_id', policyId)
      .order('issued_at', { ascending: false });

    setLoading(false);
    if (error) {
      console.error('Error fetching invoices:', error);
      return;
    }
    setInvoices((data || []).map(d => ({
      ...d,
      metadata_json: d.metadata_json as InvoiceMetadata | null,
    })) as Invoice[]);
  };

  const fetchTemplates = async () => {
    const { data } = await supabase
      .from('invoice_templates')
      .select('id, name, language, is_active')
      .order('is_active', { ascending: false });
    
    if (data) setTemplates(data);
  };

  const handleGenerateInvoice = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-invoices', {
        body: {
          policy_id: policyId,
          languages: [selectedLanguage],
          template_id: selectedTemplateId || undefined,
          created_by_admin_id: user?.id, // Pass logged-in user ID
        },
      });

      if (error) throw error;

      const result = data?.results?.[0];
      if (result?.status === 'generated' || result?.status === 'exists') {
        toast({ title: "تم", description: "تم إنشاء الفاتورة بنجاح" });
        fetchInvoices();
        setShowGenerateDialog(false);
      } else {
        throw new Error(result?.error || 'فشل في إنشاء الفاتورة');
      }
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerateInvoice = async (invoice: Invoice) => {
    setRegenerating(invoice.id);
    try {
      const { data, error } = await supabase.functions.invoke('generate-invoices', {
        body: {
          policy_id: policyId,
          languages: [invoice.language],
          regenerate: true,
          template_id: invoice.template_id,
          created_by_admin_id: user?.id, // Pass logged-in user ID
        },
      });

      if (error) throw error;
      
      toast({ title: "تم", description: "تم تجديد الفاتورة بنجاح" });
      fetchInvoices();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setRegenerating(null);
    }
  };

  const handlePrint = (invoice: Invoice) => {
    const htmlContent = invoice.metadata_json?.html_content;
    if (!htmlContent) {
      toast({ title: "خطأ", description: "لا يوجد محتوى للطباعة", variant: "destructive" });
      return;
    }

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  };

  const getLanguageLabel = (lang: string) => {
    return lang === 'ar' ? 'عربي' : lang === 'he' ? 'עברית' : lang;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'generated':
        return <Badge className="bg-green-100 text-green-800">تم الإنشاء</Badge>;
      case 'regenerated':
        return <Badge className="bg-blue-100 text-blue-800">تم التجديد</Badge>;
      case 'exists':
        return <Badge variant="secondary">موجودة</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Filter templates by selected language
  const filteredTemplates = templates.filter(t => t.language === selectedLanguage || t.language === 'both');
  const activeTemplate = filteredTemplates.find(t => t.is_active);

  // Set default template when language changes
  useEffect(() => {
    if (activeTemplate) {
      setSelectedTemplateId(activeTemplate.id);
    } else if (filteredTemplates.length > 0) {
      setSelectedTemplateId(filteredTemplates[0].id);
    } else {
      setSelectedTemplateId('');
    }
  }, [selectedLanguage, templates]);

  // Check which languages already have invoices
  const existingLanguages = new Set(invoices.map(i => i.language));

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {/* Header with Add Button - RTL: title on right, button on left */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setShowGenerateDialog(true)}>
            <Plus className="h-4 w-4 ml-1" />
            إنشاء فاتورة
          </Button>
        </div>
        <h3 className="font-semibold flex items-center gap-2 text-right">
          <FileText className="h-4 w-4" />
          الفواتير ({invoices.length})
        </h3>
      </div>

      {/* Invoices List */}
      {invoices.length === 0 ? (
        <Card className="p-6 text-center">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground mb-3">لا توجد فواتير لهذه المعاملة</p>
          <Button size="sm" onClick={() => setShowGenerateDialog(true)}>
            <Plus className="h-4 w-4 ml-1" />
            إنشاء فاتورة
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {invoices.map((invoice) => (
            <Card key={invoice.id} className="p-4 text-right">
              <div className="flex items-center justify-between">
                {/* Content on right side in RTL */}
                <div className="flex flex-col items-start gap-1">
                  <div className="flex items-center gap-2">
                    {getStatusBadge(invoice.status)}
                    <Badge variant="outline">{getLanguageLabel(invoice.language)}</Badge>
                    <span className="font-mono text-sm"><bdi>{invoice.invoice_number}</bdi></span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground" dir="auto">
                    {invoice.template?.name && (
                      <span dir="auto">• {invoice.template.name}</span>
                    )}
                    <span dir="auto">{new Date(invoice.issued_at).toLocaleDateString('en-GB')}</span>
                    <span dir="auto">• أنشئ بواسطة: {invoice.created_by?.full_name || invoice.created_by?.email || '-'}</span>
                  </div>
                </div>
                {/* Actions on left side in RTL */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handlePrint(invoice)}
                    title="طباعة"
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPreviewInvoice(invoice)}
                    title="معاينة"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRegenerateInvoice(invoice)}
                    disabled={regenerating === invoice.id}
                    title="تجديد"
                  >
                    {regenerating === invoice.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Generate Invoice Dialog */}
      <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إنشاء فاتورة جديدة</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Language Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">اللغة</label>
              <Select value={selectedLanguage} onValueChange={(v) => setSelectedLanguage(v as 'ar' | 'he')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ar">
                    عربي
                    {existingLanguages.has('ar') && <span className="text-muted-foreground mr-2">(موجودة)</span>}
                  </SelectItem>
                  <SelectItem value="he">
                    עברית
                    {existingLanguages.has('he') && <span className="text-muted-foreground mr-2">(موجودة)</span>}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Template Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">القالب</label>
              {filteredTemplates.length === 0 ? (
                <p className="text-sm text-destructive">لا توجد قوالب لهذه اللغة. الرجاء إنشاء قالب أولاً.</p>
              ) : (
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر القالب" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                        {template.is_active && <Badge className="mr-2 bg-green-100 text-green-800">نشط</Badge>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {existingLanguages.has(selectedLanguage) && (
              <p className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
                توجد فاتورة بهذه اللغة مسبقاً. سيتم تجديدها.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateDialog(false)}>
              إلغاء
            </Button>
            <Button 
              onClick={handleGenerateInvoice} 
              disabled={generating || !selectedTemplateId}
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  جاري الإنشاء...
                </>
              ) : existingLanguages.has(selectedLanguage) ? (
                'تجديد الفاتورة'
              ) : (
                'إنشاء الفاتورة'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewInvoice} onOpenChange={() => setPreviewInvoice(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0" dir="rtl">
          <DialogHeader className="p-4 border-b space-y-1">
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => previewInvoice && handlePrint(previewInvoice)}>
                <Printer className="h-4 w-4 ml-1" />
                طباعة
              </Button>
              <DialogTitle className="text-right">معاينة الفاتورة - <bdi>{previewInvoice?.invoice_number}</bdi></DialogTitle>
            </div>
            <p className="text-sm text-muted-foreground text-right" dir="auto">
              أنشئ بواسطة: {previewInvoice?.created_by?.full_name || previewInvoice?.created_by?.email || '-'}
            </p>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-4 bg-gray-50">
            {previewInvoice?.metadata_json?.html_content ? (
              <div 
                className="bg-white shadow-lg mx-auto"
                style={{ maxWidth: '210mm', minHeight: '297mm' }}
              >
                <iframe
                  srcDoc={previewInvoice.metadata_json.html_content}
                  className="w-full h-[80vh] border-0"
                  title="Invoice Preview"
                />
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-12">لا يوجد محتوى للمعاينة</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
