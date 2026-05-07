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

  // Shared page shell. The accent color (when known) tints the
  // ambient background blobs so the agent's brand color "leaks" subtly
  // into the page even though the card itself is white.
  const PageShell = ({
    children,
    title,
    accent,
  }: {
    children: React.ReactNode;
    title: string;
    accent?: string;
  }) => (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content="توقيع العميل على نموذج التأمين عبر رابط آمن لمرة واحدة." />
        <link rel="canonical" href={typeof window !== "undefined" ? window.location.href : "/"} />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="googlebot" content="noindex, nofollow" />
      </Helmet>
      <div
        className="min-h-screen relative overflow-hidden flex flex-col items-center px-4 py-10 sm:py-16 bg-[#fafbff]"
        dir="rtl"
      >
        {/* Ambient blurred blobs in the brand color — modern, airy feel */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-32 h-[420px] w-[420px] rounded-full opacity-25 blur-3xl"
          style={{ backgroundColor: accent || "#455ebb" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-32 h-[420px] w-[420px] rounded-full opacity-15 blur-3xl"
          style={{ backgroundColor: accent || "#455ebb" }}
        />

        <main className="w-full max-w-xl flex-1 flex flex-col relative z-10">{children}</main>
        <footer className="mt-10 text-center text-[11px] text-muted-foreground/70 relative z-10">
          مدعوم بواسطة{" "}
          <span className="font-semibold text-foreground/70">Thiqa</span>
        </footer>
      </div>
    </>
  );

  if (loading) {
    return (
      <PageShell title="توقيع العميل | ثقة للتأمين">
        <Card className="w-full rounded-3xl border-0 bg-white shadow-xl">
          <CardContent className="pt-10 pb-8 space-y-4">
            <Skeleton className="h-20 w-20 rounded-3xl mx-auto" />
            <Skeleton className="h-7 w-48 mx-auto" />
            <Skeleton className="h-48 w-full rounded-xl mt-6" />
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="رابط توقيع غير صالح | ثقة للتأمين" accent="#ef4444">
        <Card className="w-full rounded-3xl border-0 bg-white shadow-xl text-center overflow-hidden">
          <div className="h-1.5 w-full bg-destructive" />
          <CardContent className="pt-10 pb-10">
            <div className="mx-auto w-20 h-20 rounded-3xl bg-destructive/10 flex items-center justify-center mb-5 ring-8 ring-destructive/5">
              <AlertCircle className="h-10 w-10 text-destructive" />
            </div>
            <h2 className="text-2xl font-bold text-destructive">رابط غير صالح</h2>
            <p className="text-base text-muted-foreground mt-2">{error}</p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (alreadySigned) {
    const signedAtText = signatureInfo?.signed_at
      ? new Date(signatureInfo.signed_at).toLocaleString("en-GB")
      : null;
    return (
      <PageShell title="تم التوقيع مسبقاً | ثقة للتأمين" accent="#10b981">
        <Card className="w-full rounded-3xl border-0 bg-white shadow-xl text-center overflow-hidden">
          <div className="h-1.5 w-full bg-success" />
          <CardContent className="pt-10 pb-10">
            <div className="mx-auto w-20 h-20 rounded-3xl bg-success/10 flex items-center justify-center mb-5 ring-8 ring-success/5">
              <Check className="h-10 w-10 text-success" />
            </div>
            <h2 className="text-2xl font-bold text-success">لقد وقّعت مسبقاً</h2>
            <p className="text-base text-muted-foreground mt-2 leading-relaxed">
              {signatureInfo?.client_name
                ? `شكراً لك ${signatureInfo.client_name}، تم استلام توقيعك مسبقاً ولا حاجة للتوقيع مرة أخرى.`
                : "تم استلام توقيعك مسبقاً ولا حاجة للتوقيع مرة أخرى."}
            </p>
            {signedAtText && (
              <p className="mt-4 text-xs text-muted-foreground">
                تاريخ التوقيع:{" "}
                <span className="font-medium ltr-nums" dir="ltr">{signedAtText}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell title="تم التوقيع | ثقة للتأمين" accent="#10b981">
        <Card className="w-full rounded-3xl border-0 bg-white shadow-xl text-center overflow-hidden">
          <div className="h-1.5 w-full bg-success" />
          <CardContent className="pt-10 pb-10">
            <div className="mx-auto w-20 h-20 rounded-3xl bg-success/10 flex items-center justify-center mb-5 ring-8 ring-success/5">
              <Check className="h-10 w-10 text-success" />
            </div>
            <h2 className="text-2xl font-bold text-success">تم التوقيع بنجاح</h2>
            <p className="text-base text-muted-foreground mt-2 leading-relaxed">
              شكراً لك {signatureInfo?.client_name}، تم حفظ توقيعك بنجاح.
            </p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const tpl = signatureInfo?.template;
  // Default color matches Thiqa's primary (rgb(69 94 187) = #455ebb).
  // The agent's primary_color overrides it.
  const primaryColor = tpl?.primary_color || "#455ebb";
  const heroTitle = tpl?.company_name || "توقيع العميل";

  return (
    <PageShell title="توقيع العميل | ثقة للتأمين" accent={primaryColor}>
      {/* Floating logo above the card — modern, airy. The brand color
          shows up only as: subtle background blobs, the logo ring, the
          accent bar at the top of the card, and the submit button. */}
      <div className="flex flex-col items-center text-center mb-6 sm:mb-8">
        <div
          className="w-20 h-20 rounded-3xl bg-white shadow-lg flex items-center justify-center mb-4 overflow-hidden ring-1 ring-black/5"
          style={{ boxShadow: `0 12px 40px -12px ${primaryColor}55` }}
        >
          {tpl?.logo_url ? (
            <img
              src={tpl.logo_url}
              alt={heroTitle}
              className="max-h-14 max-w-14 object-contain"
              loading="lazy"
            />
          ) : (
            <FileSignature className="h-9 w-9" style={{ color: primaryColor }} />
          )}
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          {heroTitle}
        </h1>
        {signatureInfo?.client_name && (
          <p className="mt-1.5 text-sm sm:text-base text-muted-foreground">
            مرحباً بك،{" "}
            <span className="font-semibold text-foreground">
              {signatureInfo.client_name}
            </span>
          </p>
        )}
      </div>

      {/* Main card — clean white, soft shadow tinted with brand color */}
      <Card
        className="w-full rounded-3xl border-0 overflow-hidden bg-white"
        style={{ boxShadow: `0 24px 60px -20px ${primaryColor}33, 0 4px 16px -8px rgba(0,0,0,0.06)` }}
      >
        {/* Thin accent bar in brand color */}
        <div className="h-1.5 w-full" style={{ backgroundColor: primaryColor }} />

        <CardContent className="px-6 sm:px-10 py-8 space-y-7">
          {/* Privacy / consent text */}
          {(tpl?.header_html || tpl?.body_html || tpl?.footer_html) && (
            <section dir={tpl?.direction || "rtl"} className="space-y-3">
              {tpl?.header_html && (
                <div
                  className="text-base font-bold text-foreground"
                  dangerouslySetInnerHTML={createSafeHtml(tpl.header_html)}
                />
              )}
              {tpl?.body_html && (
                <div
                  className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground/85"
                  dangerouslySetInnerHTML={createSafeHtml(tpl.body_html)}
                />
              )}
              {tpl?.footer_html && (
                <div
                  className="text-xs text-muted-foreground pt-3 mt-1 border-t border-dashed border-border/70"
                  dangerouslySetInnerHTML={createSafeHtml(tpl.footer_html)}
                />
              )}
            </section>
          )}

          {/* Signature pad */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-bold text-foreground">
                ارسم توقيعك أدناه
              </Label>
              <button
                type="button"
                onClick={handleClear}
                disabled={submitting || !hasSignature}
                className="text-xs inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                style={{ color: primaryColor }}
              >
                <RotateCcw className="h-3 w-3" />
                مسح
              </button>
            </div>
            <div
              className="relative rounded-2xl p-3 transition-all"
              style={{
                backgroundColor: `${primaryColor}08`,
                border: `2px dashed ${primaryColor}55`,
              }}
            >
              <canvas
                ref={canvasRef}
                className="w-full touch-none rounded-xl bg-white"
                style={{ maxWidth: "100%", height: "200px" }}
              />
              {!hasSignature && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-xs text-muted-foreground/60">
                    ارسم هنا
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Consent checkbox */}
          <label
            htmlFor="accept"
            className="flex items-start gap-3 rounded-2xl border border-border/70 hover:border-border bg-muted/20 hover:bg-muted/40 transition-colors p-4 cursor-pointer"
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
          <div className="space-y-2 pt-1">
            <button
              onClick={handleSubmit}
              className="w-full h-12 rounded-2xl text-base font-bold text-white inline-flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:pointer-events-none hover:brightness-110 active:scale-[0.99]"
              style={{
                backgroundColor: primaryColor,
                boxShadow: `0 8px 24px -6px ${primaryColor}66`,
              }}
              disabled={submitting || !accepted || !hasSignature}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <Check className="h-5 w-5" />
                  تأكيد التوقيع
                </>
              )}
            </button>
            {(!hasSignature || !accepted) && (
              <p className="text-[11px] text-muted-foreground text-center">
                {!hasSignature
                  ? "يرجى رسم توقيعك في المربع أعلاه"
                  : "يرجى الموافقة على المحتوى قبل التأكيد"}
              </p>
            )}
          </div>

          {/* Expiry notice */}
          {signatureInfo?.expires_at && (
            <p className="text-[11px] text-muted-foreground text-center pt-3 border-t border-border/40">
              ينتهي هذا الرابط في:{" "}
              <span className="font-medium ltr-nums" dir="ltr">
                {new Date(signatureInfo.expires_at).toLocaleString("en-GB")}
              </span>
            </p>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
