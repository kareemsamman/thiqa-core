import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { getFullCdnUrl } from "@/lib/utils";
import { FileSignature, Send, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import DOMPurify from "dompurify";

interface ClientSignatureSectionProps {
  clientId: string;
  clientName: string;
  phoneNumber: string | null;
  signatureUrl: string | null;
  onSignatureSent?: () => void;
}

interface SignatureTemplate {
  header_html: string | null;
  body_html: string | null;
  footer_html: string | null;
  logo_url: string | null;
}

export function ClientSignatureSection({
  clientId,
  clientName,
  phoneNumber,
  signatureUrl,
  onSignatureSent,
}: ClientSignatureSectionProps) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signatureTemplate, setSignatureTemplate] = useState<SignatureTemplate | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  // Ensure signature URL has full CDN prefix
  const fullSignatureUrl = getFullCdnUrl(signatureUrl);
  const hasSigned = !!signatureUrl;

  // Fetch signature template when preview opens
  useEffect(() => {
    if (previewOpen && hasSigned && !signatureTemplate) {
      fetchSignatureTemplate();
    }
  }, [previewOpen, hasSigned]);

  const fetchSignatureTemplate = async () => {
    setLoadingTemplate(true);
    try {
      const { data, error } = await supabase
        .from('invoice_templates')
        .select('header_html, body_html, footer_html, logo_url')
        .eq('template_type', 'signature')
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      setSignatureTemplate(data);
    } catch (error) {
      console.error("Error fetching signature template:", error);
    } finally {
      setLoadingTemplate(false);
    }
  };

  // Helper to translate common edge function errors to Arabic
  const getArabicErrorMessage = (englishError: string): string => {
    const errorMap: Record<string, string> = {
      "Policy number is required before sending invoices": "يجب إدخال رقم البوليصة قبل الإرسال",
      "At least one policy file must be uploaded before sending invoices": "يجب رفع ملف بوليصة واحد على الأقل قبل الإرسال",
      "Client phone number is required": "رقم هاتف العميل مطلوب",
      "SMS service is not enabled": "خدمة الرسائل غير مفعلة",
      "Policy not found": "الوثيقة غير موجودة",
      "Client not found": "العميل غير موجود",
      "Client already has a signature": "العميل لديه توقيع مسبق",
      "Failed to fetch SMS settings": "فشل في جلب إعدادات الرسائل",
      "Failed to create signature request": "فشل في إنشاء طلب التوقيع",
      "Missing authorization header": "خطأ في المصادقة",
      "Invalid authentication": "جلسة غير صالحة",
    };
    return errorMap[englishError] || englishError;
  };

  const handleSendSignatureRequest = async () => {
    if (!phoneNumber) {
      toast({
        title: "خطأ",
        description: "لا يوجد رقم هاتف للعميل",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-signature-sms', {
        body: { client_id: clientId },
      });

      // Parse edge function error response via shared helper, then fall back
      // to the local English→Arabic translation map for any legacy messages.
      if (error) {
        const extracted = await extractFunctionErrorMessage(error);
        throw new Error(getArabicErrorMessage(extracted) || "فشل في إرسال طلب التوقيع");
      }

      // Check if response indicates the client already signed
      if (data && data.success === false) {
        toast({
          title: "تنبيه",
          description: getArabicErrorMessage(data.message) || "العميل لديه توقيع مسبق",
        });
      } else {
        toast({
          title: "تم الإرسال",
          description: `تم إرسال رابط التوقيع إلى ${phoneNumber}`,
        });
      }
      onSignatureSent?.();
    } catch (error: any) {
      console.error("Error sending signature request:", error);
      toast({
        title: "خطأ",
        description: error.message || "فشل في إرسال طلب التوقيع",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  // Build the signature HTML with the signature image embedded
  const buildSignaturePreviewHtml = () => {
    if (!signatureTemplate) return null;

    const logoHtml = signatureTemplate.logo_url 
      ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${getFullCdnUrl(signatureTemplate.logo_url)}" alt="Logo" style="max-height: 80px; max-width: 200px;" /></div>`
      : '';

    const signatureImageHtml = `
      <div style="margin: 30px 0; padding: 20px; border: 2px solid #10b981; border-radius: 12px; background: #f0fdf4;">
        <h4 style="text-align: center; color: #059669; margin: 0 0 15px 0; font-size: 16px;">توقيع العميل</h4>
        <div style="text-align: center; background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb;">
          <img src="${fullSignatureUrl}" alt="توقيع العميل" style="max-width: 100%; max-height: 150px; object-fit: contain;" />
        </div>
        <p style="text-align: center; margin: 10px 0 0 0; font-size: 12px; color: #6b7280;">
          ${clientName}
        </p>
      </div>
    `;

    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.8;
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
            color: #374151;
          }
          h3, h4 {
            color: #1f2937;
          }
          ul {
            padding-right: 20px;
          }
          li {
            margin-bottom: 8px;
          }
        </style>
      </head>
      <body>
        ${logoHtml}
        ${signatureTemplate.header_html || ''}
        ${signatureTemplate.body_html || ''}
        ${signatureImageHtml}
        ${signatureTemplate.footer_html || ''}
      </body>
      </html>
    `;

    return html;
  };

  return (
    <>
      <Card className={hasSigned ? "border-success/30 bg-success/5" : "border-amber-500/30 bg-amber-500/5"}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileSignature className="h-4 w-4" />
            توقيع العميل
            {hasSigned ? (
              <Badge variant="success" className="mr-auto gap-1">
                <CheckCircle2 className="h-3 w-3" />
                تم التوقيع
              </Badge>
            ) : (
              <Badge variant="warning" className="mr-auto gap-1">
                <AlertTriangle className="h-3 w-3" />
                لم يوقّع
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hasSigned ? (
            <div className="space-y-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreviewOpen(true)}
                className="w-full gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                عرض التوقيع
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                العميل لم يوقّع بعد. أرسل له رابط التوقيع عبر SMS.
              </p>
              <Button
                size="sm"
                onClick={handleSendSignatureRequest}
                disabled={sending || !phoneNumber}
                className="w-full gap-2"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                إرسال طلب التوقيع
              </Button>
              {!phoneNumber && (
                <p className="text-xs text-destructive text-center">
                  لا يوجد رقم هاتف
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Signature Preview Dialog with full HTML template */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle>توقيع العميل - {clientName}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto bg-white rounded-lg border">
            {loadingTemplate ? (
              <div className="p-8 space-y-4">
                <Skeleton className="h-8 w-1/2 mx-auto" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-32 w-full mt-4" />
              </div>
            ) : signatureTemplate ? (
              <div 
                className="p-6"
                dangerouslySetInnerHTML={{ 
                  __html: DOMPurify.sanitize(buildSignaturePreviewHtml() || '', {
                    ADD_TAGS: ['style'],
                    ADD_ATTR: ['target'],
                  })
                }}
              />
            ) : (
              // Fallback: just show the signature image if no template
              <div className="flex items-center justify-center p-8">
                {fullSignatureUrl && (
                  <div className="text-center">
                    <h4 className="text-lg font-semibold mb-4 text-success">توقيع العميل</h4>
                    <div className="border-2 border-success/30 rounded-lg p-4 bg-success/5">
                      <img
                        src={fullSignatureUrl}
                        alt={`توقيع العميل ${clientName}`}
                        loading="lazy"
                        className="max-w-full max-h-[50vh] object-contain mx-auto"
                      />
                    </div>
                    <p className="text-muted-foreground mt-2">{clientName}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
