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
    /** Hex color the agent picked in BrandingSettings (defaults to
     *  Thiqa's primary if unset). Applied to the hero gradient. */
    primary_color?: string;
    /** Agent's company name, shown as the hero title. */
    company_name?: string;
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
  const [alreadySigned, setAlreadySigned] = useState(false);
  // True only after the user has actually drawn at least one stroke on
  // the canvas. A bare click without dragging does NOT count — Fabric's
  // path:created fires only on drag-release, so the submit button stays
  // disabled until there's a real signature.
  const [hasSignature, setHasSignature] = useState(false);

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

    // Track whether the canvas has any actual drawn paths. path:created
    // fires once per stroke (after mouseup), so a single click without
    // a drag won't flip this on.
    const onPathCreated = () => setHasSignature(true);
    canvas.on("path:created", onPathCreated);

    setFabricCanvas(canvas);

    return () => {
      canvas.off("path:created", onPathCreated);
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
        setAlreadySigned(true);
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
    setHasSignature(false);
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

  // Shared page shell: subtle gradient background, centered content, RTL,
  // Thiqa attribution footer. Used by every state (loading/error/signed/etc.)
  const PageShell = ({ children, title }: { children: React.ReactNode; title: string }) => (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content="توقيع العميل على نموذج التأمين عبر رابط آمن لمرة واحدة." />
        <link rel="canonical" href={typeof window !== "undefined" ? window.location.href : "/"} />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="googlebot" content="noindex, nofollow" />
      </Helmet>
      <div
        className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-background to-muted/40 flex flex-col items-center px-4 py-8 sm:py-12"
        dir="rtl"
      >
        <main className="w-full max-w-2xl flex-1 flex flex-col">{children}</main>
        <footer className="mt-8 text-center text-[11px] text-muted-foreground/70">
          مدعوم بواسطة{" "}
          <span className="font-semibold text-foreground/70">Thiqa</span>
        </footer>
      </div>
    </>
  );

  if (loading) {
    return (
      <PageShell title="توقيع العميل | ثقة للتأمين">
        <Card className="w-full rounded-2xl border-border/60 shadow-xl shadow-primary/5">
          <CardHeader>
            <Skeleton className="h-8 w-40 mx-auto" />
            <Skeleton className="h-4 w-56 mx-auto mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48 w-full rounded-xl" />
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="رابط توقيع غير صالح | ثقة للتأمين">
        <Card className="w-full rounded-2xl border-border/60 shadow-xl shadow-destructive/5 text-center">
          <CardHeader className="pt-10 pb-8">
            <div className="mx-auto w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mb-5 ring-8 ring-destructive/5">
              <AlertCircle className="h-10 w-10 text-destructive" />
            </div>
            <CardTitle className="text-2xl text-destructive">رابط غير صالح</CardTitle>
            <CardDescription className="text-base mt-2">{error}</CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  if (alreadySigned) {
    const signedAtText = signatureInfo?.signed_at
      ? new Date(signatureInfo.signed_at).toLocaleString("en-GB")
      : null;
    return (
      <PageShell title="تم التوقيع مسبقاً | ثقة للتأمين">
        <Card className="w-full rounded-2xl border-border/60 shadow-xl shadow-success/5 text-center">
          <CardHeader className="pt-10 pb-8">
            <div className="mx-auto w-20 h-20 rounded-full bg-success/10 flex items-center justify-center mb-5 ring-8 ring-success/5">
              <Check className="h-10 w-10 text-success" />
            </div>
            <CardTitle className="text-2xl text-success">لقد وقّعت مسبقاً</CardTitle>
            <CardDescription className="text-base mt-2 leading-relaxed">
              {signatureInfo?.client_name
                ? `شكراً لك ${signatureInfo.client_name}، تم استلام توقيعك مسبقاً ولا حاجة للتوقيع مرة أخرى.`
                : "تم استلام توقيعك مسبقاً ولا حاجة للتوقيع مرة أخرى."}
            </CardDescription>
            {signedAtText && (
              <p className="mt-4 text-xs text-muted-foreground">
                تاريخ التوقيع: <span className="font-medium">{signedAtText}</span>
              </p>
            )}
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell title="تم التوقيع | ثقة للتأمين">
        <Card className="w-full rounded-2xl border-border/60 shadow-xl shadow-success/5 text-center">
          <CardHeader className="pt-10 pb-8">
            <div className="mx-auto w-20 h-20 rounded-full bg-success/10 flex items-center justify-center mb-5 ring-8 ring-success/5">
              <Check className="h-10 w-10 text-success" />
            </div>
            <CardTitle className="text-2xl text-success">تم التوقيع بنجاح</CardTitle>
            <CardDescription className="text-base mt-2 leading-relaxed">
              شكراً لك {signatureInfo?.client_name}، تم حفظ توقيعك بنجاح.
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  const tpl = signatureInfo?.template;
  // Always render the Thiqa hero pattern; the agent's primary color
  // tints the gradient and their logo (if any) replaces the default
  // FileSignature icon. Title is the agent's company name when set,
  // otherwise the generic "توقيع العميل".
  const primaryColor = tpl?.primary_color || "#1e3a5f";
  const heroTitle = tpl?.company_name || "توقيع العميل";

  return (
    <PageShell title="توقيع العميل | ثقة للتأمين">
      <Card className="w-full rounded-2xl border-border/60 shadow-xl shadow-primary/5 overflow-hidden">
        {/* Thiqa-style hero — same layout regardless of template; only the
            background color, logo, and title come from the agent. */}
        <div
          className="relative px-6 sm:px-10 pt-10 pb-12 text-center text-white"
          style={{
            backgroundImage: `linear-gradient(to bottom right, ${primaryColor}, ${primaryColor}dd)`,
          }}
        >
          <div className="mx-auto w-16 h-16 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mb-4 ring-1 ring-white/25 overflow-hidden">
            {tpl?.logo_url ? (
              <img
                src={tpl.logo_url}
                alt={heroTitle}
                className="max-h-12 max-w-12 object-contain"
                loading="lazy"
              />
            ) : (
              <FileSignature className="h-8 w-8" />
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {heroTitle}
          </h1>
          {signatureInfo?.client_name && (
            <p className="mt-2 text-white/80 text-sm sm:text-base">
              مرحباً بك{" "}
              <span className="font-semibold text-white">
                {signatureInfo.client_name}
              </span>
            </p>
          )}
        </div>

        <CardContent className="px-6 sm:px-10 py-8 space-y-6">
          {/* Body / header / footer agent HTML — rendered inside a
              Thiqa-style soft card so it stays consistent visually. */}
          {(tpl?.header_html || tpl?.body_html || tpl?.footer_html) && (
            <div
              className="prose prose-sm max-w-none rounded-xl bg-muted/40 border border-border/60 px-5 py-4"
              dir={tpl?.direction || "rtl"}
            >
              {tpl?.header_html && (
                <div
                  className="font-semibold text-foreground mb-3"
                  dangerouslySetInnerHTML={createSafeHtml(tpl.header_html)}
                />
              )}
              {tpl?.body_html && (
                <div dangerouslySetInnerHTML={createSafeHtml(tpl.body_html)} />
              )}
              {tpl?.footer_html && (
                <div
                  className="mt-4 pt-4 border-t border-border/60 text-xs text-muted-foreground"
                  dangerouslySetInnerHTML={createSafeHtml(tpl.footer_html)}
                />
              )}
            </div>
          )}

          {/* Signature pad */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">توقيعك</Label>
              <button
                type="button"
                onClick={handleClear}
                disabled={submitting}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                مسح
              </button>
            </div>
            <div className="rounded-xl border-2 border-dashed border-primary/40 bg-gradient-to-b from-background to-muted/20 p-2 transition-colors hover:border-primary/60">
              <canvas
                ref={canvasRef}
                className="w-full touch-none rounded-lg"
                style={{ maxWidth: "100%", height: "200px" }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              استخدم الماوس أو إصبعك للتوقيع في المربع أعلاه
            </p>
          </div>

          {/* Consent checkbox */}
          <label
            htmlFor="accept"
            className="flex items-start gap-3 rounded-xl border bg-muted/30 hover:bg-muted/50 transition-colors p-4 cursor-pointer"
          >
            <Checkbox
              id="accept"
              checked={accepted}
              onCheckedChange={(v) => setAccepted(!!v)}
              className="mt-0.5"
            />
            <span className="text-sm leading-relaxed text-foreground/90">
              أقرّ أنني قرأت وأوافق على المحتوى أعلاه.
            </span>
          </label>

          {/* Submit. Disabled until the user has actually drawn a
              signature AND accepted the consent — a stray click on the
              canvas is not enough. */}
          <Button
            onClick={handleSubmit}
            className="w-full h-12 text-base shadow-lg shadow-primary/20"
            disabled={submitting || !accepted || !hasSignature}
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin ml-2" />
                جاري الحفظ...
              </>
            ) : (
              <>
                <Check className="h-5 w-5 ml-2" />
                تأكيد التوقيع
              </>
            )}
          </Button>
          {!hasSignature && (
            <p className="text-[11px] text-muted-foreground text-center -mt-2">
              يرجى رسم توقيعك في المربع أعلاه قبل التأكيد
            </p>
          )}

          {/* Expiry notice */}
          {signatureInfo?.expires_at && (
            <p className="text-[11px] text-muted-foreground text-center pt-2 border-t border-border/40">
              ينتهي هذا الرابط في:{" "}
              <span className="font-medium">
                {new Date(signatureInfo.expires_at).toLocaleString("en-GB")}
              </span>
            </p>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
