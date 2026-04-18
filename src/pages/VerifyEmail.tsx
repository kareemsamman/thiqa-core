import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, Mail, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import thiqaLogoDark from "@/assets/thiqa-logo-dark.svg";
import { OtpInput } from "@/components/auth/OtpInput";
import { PublicSEO } from "@/components/public/PublicSEO";

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") || "";
  const navigate = useNavigate();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Countdown for resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(prev => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Check bypass on mount — if skip is enabled, auto-confirm and redirect
  useEffect(() => {
    if (!email) return;

    const checkBypass = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("registration-otp-verify", {
          body: { email, skip: true },
        });
        if (!error && data?.success) {
          toast.success("تم تفعيل الحساب تلقائياً!");
          // Try auto-login if password is in URL
          const pw = new URLSearchParams(window.location.search).get("p");
          if (pw) {
            const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password: pw });
            if (!loginErr) {
              navigate("/", { replace: true });
              return;
            }
          }
          navigate("/login", { replace: true });
          return;
        }
      } catch {}

      // Not bypassed — send OTP as normal
      sendOtp();
    };

    checkBypass();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendOtp = useCallback(async () => {
    if (!email) return;
    setResendCooldown(60);
    try {
      const { data, error } = await supabase.functions.invoke("registration-otp-send", {
        body: { email },
      });
      if (error) {
        try {
          const errBody = await (error as any).context?.json?.();
          throw new Error(errBody?.error || error.message);
        } catch {
          throw error;
        }
      }
      if (data?.error) throw new Error(data.error);
      setFeedback({ type: "info", message: data?.message || "تم إرسال رمز التحقق إلى بريدك الإلكتروني" });
    } catch (e: any) {
      setFeedback({ type: "error", message: e.message || "فشل في إرسال الرمز" });
    }
  }, [email]);

  const handleVerify = async () => {
    const trimmedCode = code.replace(/\D/g, "").slice(0, 4);
    if (trimmedCode.length !== 4) {
      setFeedback({ type: "error", message: "يرجى إدخال الرمز المكون من 4 أرقام" });
      return;
    }

    setLoading(true);
    setFeedback(null);

    try {
      const { data, error } = await supabase.functions.invoke("registration-otp-verify", {
        body: { email, code: trimmedCode },
      });

      if (error) {
        try {
          const errBody = await (error as any).context?.json?.();
          throw new Error(errBody?.error || error.message);
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr;
          throw error;
        }
      }
      if (data?.error) throw new Error(data.error);

      setFeedback({ type: "success", message: "تم تأكيد البريد الإلكتروني بنجاح!" });
      toast.success("تم تأكيد البريد الإلكتروني بنجاح!");

      // Auto-login using password from URL params, then redirect to dashboard
      const pw = searchParams.get("p");
      if (pw) {
        const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (!loginErr) {
          setTimeout(() => navigate("/", { replace: true }), 1000);
          return;
        }
      }

      // Fallback: check existing session or redirect to login
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setTimeout(() => navigate("/", { replace: true }), 1000);
      } else {
        setTimeout(() => navigate("/login", { replace: true }), 2000);
      }
    } catch (e: any) {
      setFeedback({ type: "error", message: e.message || "رمز غير صحيح" });
    } finally {
      setLoading(false);
    }
  };

  if (!email) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" dir="rtl">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">لا يوجد بريد إلكتروني للتحقق منه.</p>
          <Button onClick={() => navigate("/login")}>العودة لتسجيل الدخول</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-muted/40 to-background p-6" dir="rtl">
      <PublicSEO
        title="Thiqa | تأكيد البريد الإلكتروني"
        description="أكمل تسجيل حسابك في Thiqa بتأكيد بريدك الإلكتروني."
      />
      <div className="w-full max-w-md animate-scale-in">
        <div className="rounded-3xl border border-white/20 bg-white/70 dark:bg-card/70 backdrop-blur-xl shadow-2xl shadow-black/10 overflow-hidden">
          <div className="text-center pt-10 pb-4 px-8">
            <img src={thiqaLogoDark} alt="Thiqa" className="mx-auto h-10 w-auto object-contain mb-4" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">تأكيد البريد الإلكتروني</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              أرسلنا رمز تحقق مكون من 4 أرقام إلى
            </p>
            <p className="text-primary font-medium text-sm mt-1 dir-ltr" dir="ltr">{email}</p>
          </div>

          <div className="px-8 pb-10 space-y-6">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Mail className="h-5 w-5" />
              <span className="text-sm">تحقق من بريدك الإلكتروني</span>
            </div>

            <div className="flex justify-center">
              <OtpInput
                value={code}
                onChange={setCode}
                disabled={loading}
              />
            </div>

            <Button
              className="w-full h-12 text-base gap-2 rounded-xl shadow-lg flex-row-reverse"
              onClick={handleVerify}
              disabled={loading || code.replace(/\D/g, "").length < 4}
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5 rotate-180" />}
              {loading ? "جاري التحقق..." : "تأكيد البريد الإلكتروني"}
            </Button>

            {feedback && (
              <div
                className={`rounded-xl border p-3 text-sm flex items-start gap-2 ${
                  feedback.type === "success"
                    ? "border-green-500/30 bg-green-500/10 text-green-700"
                    : feedback.type === "error"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-primary/30 bg-primary/10 text-primary"
                }`}
              >
                {feedback.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                ) : feedback.type === "error" ? (
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <Mail className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <p className="leading-5">{feedback.message}</p>
              </div>
            )}

            <div className="text-center space-y-2">
              <p className="text-xs text-muted-foreground">لم يصلك الرمز؟</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={sendOtp}
                disabled={resendCooldown > 0}
                className="text-primary"
              >
                {resendCooldown > 0
                  ? `إعادة إرسال بعد ${resendCooldown} ثانية`
                  : "إعادة إرسال الرمز"}
              </Button>
            </div>

            <div className="text-center">
              <Button
                variant="link"
                size="sm"
                onClick={() => navigate("/login")}
                className="text-muted-foreground"
              >
                العودة لتسجيل الدخول
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
