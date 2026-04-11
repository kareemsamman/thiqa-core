import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowRight, CheckCircle2, Mail } from "lucide-react";
import { toast } from "sonner";
import thiqaLogoDark from "@/assets/thiqa-logo-dark.svg";
import loginBgMobile from "@/assets/login-bg-mobile.png";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const [isGoogleAccount, setIsGoogleAccount] = useState(false);

  const handleSubmit = async () => {
    if (!email || !email.includes("@")) {
      toast.error("يرجى إدخال بريد إلكتروني صحيح");
      return;
    }
    setLoading(true);
    setIsGoogleAccount(false);
    try {
      const { data, error } = await supabase.functions.invoke("send-password-reset", {
        body: {
          email: email.trim(),
          redirectTo: `${window.location.origin}/reset-password`,
        },
      });
      if (error) throw error;
      if (data?.error) {
        if (data.error.includes("Google") || data.error.includes("google") || data.error.includes("OAuth")) {
          setIsGoogleAccount(true);
          setSent(true);
          return;
        }
        throw new Error(data.error);
      }
      setSent(true);
    } catch (e: any) {
      toast.error(e.message || "حدث خطأ في إرسال رابط إعادة التعيين");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative" dir="rtl">
      <div className="fixed inset-0 lg:hidden -z-10">
        <img src={loginBgMobile} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/30 backdrop-blur-md" />
      </div>
      <div className="hidden lg:block fixed inset-0 -z-10 bg-gradient-to-br from-muted/40 to-background" />

      <div className="w-full max-w-md animate-scale-in">
        <div className="rounded-3xl border border-white/20 bg-white/95 dark:bg-card/95 lg:bg-white/70 lg:dark:bg-card/70 backdrop-blur-xl shadow-2xl shadow-black/10 overflow-hidden">
          <div className="text-center pt-8 pb-4 px-5 sm:px-8">
            <img src={thiqaLogoDark} alt="ثقة" className="mx-auto h-10 w-auto object-contain mb-2" />
            <h1 className="text-2xl font-bold text-foreground">نسيت كلمة المرور؟</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {sent ? "تم إرسال رابط إعادة التعيين" : "أدخل بريدك الإلكتروني وسنرسل لك رابط لإعادة تعيين كلمة المرور"}
            </p>
          </div>

          <div className="px-5 sm:px-8 pb-8 space-y-4">
            {sent ? (
              <div className="text-center space-y-4 py-4">
                {isGoogleAccount ? (
                  <>
                    <div className="mx-auto w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                      <svg className="h-8 w-8" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                    </div>
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">حساب مسجل عبر Google</p>
                      <p className="text-sm text-muted-foreground">
                        هذا الحساب مسجل عبر Google ولا يحتاج كلمة مرور.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        استخدم زر "تسجيل الدخول بـ Google" في صفحة الدخول.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mx-auto w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <CheckCircle2 className="h-8 w-8 text-green-600" />
                    </div>
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">تم الإرسال بنجاح!</p>
                      <p className="text-sm text-muted-foreground">
                        تم إرسال رابط إعادة تعيين كلمة المرور إلى
                      </p>
                      <p className="text-sm font-medium text-primary" dir="ltr">{email}</p>
                      <p className="text-xs text-muted-foreground mt-3">
                        تحقق من بريدك الإلكتروني واضغط على الرابط لإعادة تعيين كلمة المرور.
                        <br />
                        إذا لم تجد الرسالة، تحقق من مجلد الرسائل غير المرغوب فيها.
                      </p>
                    </div>
                  </>
                )}
                <div className="flex flex-col gap-2 pt-2">
                  <Button
                    variant="outline"
                    className="w-full h-11 rounded-xl gap-2"
                    onClick={() => { setSent(false); setEmail(""); }}
                  >
                    <Mail className="h-4 w-4" />
                    إرسال مرة أخرى
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full h-11 rounded-xl gap-2"
                    onClick={() => navigate("/login")}
                  >
                    <ArrowRight className="h-4 w-4" />
                    العودة لتسجيل الدخول
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="reset-email" className="text-sm font-medium">البريد الإلكتروني</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="your-email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 rounded-xl bg-white/60 dark:bg-card/60 backdrop-blur-sm border-border/60"
                    disabled={loading}
                    dir="ltr"
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  />
                </div>
                <Button
                  className="w-full h-12 text-base gap-2 rounded-xl shadow-lg"
                  onClick={handleSubmit}
                  disabled={loading || !email}
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin ml-2" /> : <Mail className="h-5 w-5" />}
                  {loading ? "جاري الإرسال..." : "إرسال رابط إعادة التعيين"}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full h-11 rounded-xl gap-2 text-muted-foreground"
                  onClick={() => navigate("/login")}
                >
                  <ArrowRight className="h-4 w-4" />
                  العودة لتسجيل الدخول
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
