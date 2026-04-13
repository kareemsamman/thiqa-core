import { useState, useEffect, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useParams, useNavigate } from "react-router-dom";
import { Canvas as FabricCanvas, PencilBrush } from "fabric";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RotateCcw, Check, AlertCircle, FileSignature } from "lucide-react";
import { createSafeHtml } from "@/lib/sanitize";

interface SignatureInfo {
  valid: boolean;
  client_name?: string;
  expires_at?: string;
  already_signed?: boolean;
  signed_at?: string;
  message?: string;
  template?: {
    header_html?: string;
    body_html?: string;
    footer_html?: string;
    logo_url?: string;
    direction?: string;
  } | null;
}

export default function SignaturePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [signatureInfo, setSignatureInfo] = useState<SignatureInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (token) {
      fetchSignatureInfo();
    }
  }, [token]);

  useEffect(() => {
    if (!canvasRef.current || !signatureInfo?.valid) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 400,
      height: 200,
      backgroundColor: "#ffffff",
      isDrawingMode: true,
    });

    // Configure drawing brush
    canvas.freeDrawingBrush = new PencilBrush(canvas);
    canvas.freeDrawingBrush.color = "#000000";
    canvas.freeDrawingBrush.width = 2;

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [signatureInfo?.valid]);

  const fetchSignatureInfo = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-signature-info?token=${token}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "رابط التوقيع غير صالح");
        return;
      }

      setSignatureInfo(data);

      if (data.already_signed) {
        setSubmitted(true);
      }
    } catch (err) {
      console.error("Error fetching signature info:", err);
      setError("فشل في تحميل معلومات التوقيع");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    if (fabricCanvas) {
      fabricCanvas.clear();
      fabricCanvas.backgroundColor = "#ffffff";
      fabricCanvas.renderAll();
    }
  };

  const handleSubmit = async () => {
    if (!fabricCanvas || !token) return;

    // Check if canvas has any drawing
    if (fabricCanvas.getObjects().length === 0) {
      toast({
        title: "خطأ",
        description: "يرجى رسم توقيعك أولاً",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const signatureDataUrl = fabricCanvas.toDataURL({
        format: "png",
        quality: 1,
        multiplier: 2,
      });

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-signature`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token,
            signature_data_url: signatureDataUrl,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "فشل في إرسال التوقيع");
      }

      setSubmitted(true);
      toast({
        title: "تم بنجاح",
        description: "تم حفظ توقيعك بنجاح",
      });
    } catch (err: any) {
      console.error("Error submitting signature:", err);
      toast({
        title: "خطأ",
        description: err.message || "فشل في إرسال التوقيع",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <>
        <Helmet>
          <title>توقيع العميل | ثقة للتأمين</title>
          <meta name="description" content="توقيع العميل على نموذج التأمين عبر رابط آمن لمرة واحدة." />
          <link rel="canonical" href={typeof window !== "undefined" ? window.location.href : "/"} />
        </Helmet>
        <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4" dir="rtl">
          <Card className="w-full max-w-md">
            <CardHeader>
              <Skeleton className="h-8 w-32 mx-auto" />
              <Skeleton className="h-4 w-48 mx-auto mt-2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-48 w-full" />
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Helmet>
          <title>رابط توقيع غير صالح | ثقة للتأمين</title>
          <meta name="description" content="رابط التوقيع غير صالح أو منتهي." />
          <link rel="canonical" href={typeof window !== "undefined" ? window.location.href : "/"} />
        </Helmet>
        <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4" dir="rtl">
          <Card className="w-full max-w-md text-center">
            <CardHeader>
              <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <CardTitle className="text-destructive">رابط غير صالح</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </>
    );
  }

  if (submitted) {
    return (
      <>
        <Helmet>
          <title>تم التوقيع | ثقة للتأمين</title>
          <meta name="description" content="تم حفظ توقيع العميل بنجاح." />
          <link rel="canonical" href={typeof window !== "undefined" ? window.location.href : "/"} />
        </Helmet>
        <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4" dir="rtl">
          <Card className="w-full max-w-md text-center">
            <CardHeader>
              <div className="mx-auto w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mb-4">
                <Check className="h-8 w-8 text-success" />
              </div>
              <CardTitle className="text-success">تم التوقيع بنجاح</CardTitle>
              <CardDescription>
                شكراً لك {signatureInfo?.client_name}، تم حفظ توقيعك بنجاح.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>توقيع العميل | ثقة للتأمين</title>
        <meta name="description" content="توقيع العميل على نموذج التأمين عبر رابط آمن لمرة واحدة." />
        <link rel="canonical" href={typeof window !== "undefined" ? window.location.href : "/"} />
      </Helmet>
      <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4" dir="rtl">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
              <FileSignature className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>توقيع العميل</CardTitle>
            <CardDescription>
              مرحباً {signatureInfo?.client_name}، يرجى التوقيع في المربع أدناه
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            {/* Template content if available */}
            {signatureInfo?.template && (
              <div 
                className="prose prose-sm max-w-none mb-4 p-4 bg-muted/30 rounded-lg text-sm"
                dir={signatureInfo.template.direction || "rtl"}
              >
                {signatureInfo.template.logo_url && (
                  <img 
                    src={signatureInfo.template.logo_url} 
                    alt="شعار الشركة"
                    className="h-12 mx-auto mb-4"
                    loading="lazy"
                  />
                )}
                {signatureInfo.template.header_html && (
                  <div dangerouslySetInnerHTML={createSafeHtml(signatureInfo.template.header_html)} />
                )}
                {signatureInfo.template.body_html && (
                  <div dangerouslySetInnerHTML={createSafeHtml(signatureInfo.template.body_html)} />
                )}
                {signatureInfo.template.footer_html && (
                  <div dangerouslySetInnerHTML={createSafeHtml(signatureInfo.template.footer_html)} />
                )}
              </div>
            )}

            {/* Signature Canvas */}
            <div className="border-2 border-dashed border-primary/30 rounded-lg p-2 bg-background">
              <canvas 
                ref={canvasRef} 
                className="w-full touch-none"
                style={{ maxWidth: "100%", height: "200px" }}
              />
            </div>

            <p className="text-xs text-muted-foreground text-center">
              استخدم الماوس أو إصبعك للتوقيع
            </p>

            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
              <Checkbox
                id="accept"
                checked={accepted}
                onCheckedChange={(v) => setAccepted(!!v)}
              />
              <Label htmlFor="accept" className="text-sm leading-relaxed">
                أقرّ أنني قرأت وأوافق على المحتوى أعلاه.
              </Label>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleClear}
                className="flex-1"
                disabled={submitting}
              >
                <RotateCcw className="h-4 w-4 ml-2" />
                مسح
              </Button>
              <Button
                onClick={handleSubmit}
                className="flex-1"
                disabled={submitting || !accepted}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                ) : (
                  <Check className="h-4 w-4 ml-2" />
                )}
                تأكيد التوقيع
              </Button>
            </div>

            {/* Expiry notice */}
            {signatureInfo?.expires_at && (
              <p className="text-xs text-muted-foreground text-center">
                ينتهي هذا الرابط في: {new Date(signatureInfo.expires_at).toLocaleString("en-GB")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
