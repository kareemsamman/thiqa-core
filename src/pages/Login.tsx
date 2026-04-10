import { useCallback, useEffect, useState } from "react";
import { trackEvent } from "@/hooks/useAnalyticsTracker";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, AlertCircle, ArrowRight, Eye, EyeOff, UserPlus, CheckCircle2, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import thiqaLogo from "@/assets/thiqa-logo-full.svg";
import thiqaLogoDark from "@/assets/thiqa-logo-dark.svg";
import loginBgMobile from "@/assets/login-bg-mobile.png";
import { isThiqaSuperAdminEmail } from "@/lib/superAdmin";
import { Separator } from "@/components/ui/separator";
import { digitsOnly } from "@/lib/validation";

type PageView = "login" | "signup";
type SignupFeedback = { type: "success" | "error" | "info"; message: string };

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const navigate = useNavigate();
  const { user, isActive, isSuperAdmin, loading: authLoading } = useAuth();
  
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  const [pageView, setPageView] = useState<PageView>(searchParams.get("view") === "signup" ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);


  // Signup fields
  const [fullName, setFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  
  // Signup validation errors (shown after attempted submit)
  const [signupErrors, setSignupErrors] = useState<Record<string, string>>({});
  const [signupFeedback, setSignupFeedback] = useState<SignupFeedback | null>(null);

  useEffect(() => {
    try { setIsInIframe(window.self !== window.top); } catch { setIsInIframe(true); }
  }, []);

  const tryBypassEmailVerification = useCallback(async (targetEmail: string) => {
    const normalizedEmail = targetEmail.trim().toLowerCase();
    if (!normalizedEmail) return false;

    const { data, error } = await supabase.functions.invoke("registration-otp-verify", {
      body: { email: normalizedEmail, skip: true },
    });

    if (error || data?.error) return false;
    return data?.success === true;
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      if (!isThiqaSuperAdminEmail(user.email)) {
        sessionStorage.setItem('admin_session_active', 'true');
      }

      // Super admin bypasses all checks
      if (isThiqaSuperAdminEmail(user.email)) {
        navigate('/thiqa', { replace: true });
        return;
      }

      const checkEmailConfirmed = async () => {
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('email_confirmed')
            .eq('id', user.id)
            .maybeSingle();

          let emailConfirmed = profile?.email_confirmed === true;

          if (!emailConfirmed) {
            const bypassed = await tryBypassEmailVerification(user.email || '');
            if (!bypassed) {
              navigate(`/verify-email?email=${encodeURIComponent(user.email || '')}`, { replace: true });
              return;
            }
            emailConfirmed = true;
          }

          if (emailConfirmed || isActive) {
            navigate('/', { replace: true });
          } else {
            navigate('/no-access', { replace: true });
          }
        } catch (err) {
          console.error('[Login] checkEmailConfirmed error:', err);
          // Fallback: navigate based on active status
          if (isActive) {
            navigate('/', { replace: true });
          } else {
            navigate('/no-access', { replace: true });
          }
        }
      };

      checkEmailConfirmed();
    }
  }, [user, isActive, isSuperAdmin, authLoading, navigate, tryBypassEmailVerification]);

  const handleGoogleLogin = async () => {
    if (isInIframe) { window.open(window.location.href, '_blank'); return; }
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) {
        if (error.message.includes('provider is not enabled')) {
          toast.error("مزود Google غير مفعل.");
        } else {
          toast.error("حدث خطأ في تسجيل الدخول");
        }
      }
    } catch { toast.error("حدث خطأ غير متوقع"); }
    finally { setLoading(false); }
  };

  const handleEmailPasswordLogin = async () => {
    if (!email || !email.includes("@")) { toast.error("يرجى إدخال بريد إلكتروني صحيح"); return; }
    if (!password || password.length < 6) { toast.error("كلمة المرور 6 أحرف على الأقل"); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        const isEmailNotConfirmed =
          (error as any)?.code === "email_not_confirmed" ||
          error.message.includes("Email not confirmed");

        if (error.message.includes("Invalid login credentials")) {
          toast.error("البريد الإلكتروني أو كلمة المرور غير صحيحة");
        } else if (isEmailNotConfirmed) {
          toast.info("جاري محاولة تفعيل الحساب تلقائياً...");
          const bypassed = await tryBypassEmailVerification(email.trim());

          if (bypassed) {
            const { error: retryError } = await supabase.auth.signInWithPassword({
              email: email.trim(),
              password,
            });

            if (retryError) {
              toast.error("فشل تسجيل الدخول بعد التفعيل");
            } else {
              toast.success("تم تسجيل الدخول بنجاح");
              // useEffect will handle navigation when user state updates
              return;
            }
          } else {
            toast.info("يرجى تأكيد بريدك الإلكتروني");
            navigate(`/verify-email?email=${encodeURIComponent(email.trim())}`, { replace: true });
          }
        } else {
          toast.error(error.message);
        }
        return;
      }
      toast.success("تم تسجيل الدخول بنجاح");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "حدث خطأ غير متوقع");
    } finally { setLoading(false); }
  };

  const extractFunctionMessage = (raw: string) => {
    const match = raw.match(/\{.*\}$/);
    if (!match) return raw;
    try {
      const payload = JSON.parse(match[0]);
      return payload?.error || payload?.message || raw;
    } catch {
      return raw;
    }
  };

  const extractInvokeErrorMessage = async (rawError: unknown) => {
    if (!(rawError instanceof Error)) return "حدث خطأ غير متوقع";

    const response = (rawError as Error & { context?: Response }).context;
    if (response && typeof response.json === "function") {
      try {
        const payload = await response.clone().json();
        if (payload?.error || payload?.message) {
          return payload.error || payload.message;
        }
      } catch {
        // noop - fallback to normal error parsing
      }
    }

    return extractFunctionMessage(rawError.message);
  };

  const validateSignupForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!fullName.trim()) errors.fullName = "الاسم الكامل مطلوب";
    if (!signupEmail || !signupEmail.includes("@")) errors.signupEmail = "يرجى إدخال بريد إلكتروني صحيح";
    if (signupPhone.trim() && digitsOnly(signupPhone).length !== 10) errors.signupPhone = "رقم الهاتف يجب أن يكون 10 أرقام";
    if (!signupPassword || signupPassword.length < 6) errors.signupPassword = "كلمة المرور 6 أحرف على الأقل";
    if (signupPassword !== signupConfirmPassword) errors.signupConfirmPassword = "كلمة المرور غير متطابقة";
    return errors;
  };

  const handleSignup = async () => {
    setSignupFeedback(null);

    const errors = validateSignupForm();
    setSignupErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSignupFeedback({ type: "error", message: "يرجى تصحيح الأخطاء قبل إكمال التسجيل" });
      return;
    }

    setLoading(true);
    setSignupFeedback({ type: "info", message: "جارٍ إنشاء وكالة جديدة..." });

    try {
      const { data, error } = await supabase.functions.invoke("register-agent", {
        body: {
          first_name: fullName.trim().split(" ")[0] || fullName.trim(),
          last_name: fullName.trim().split(" ").slice(1).join(" ") || "",
          email: signupEmail.trim(),
          password: signupPassword,
          phone: digitsOnly(signupPhone) || null,
        },
      });

      if (error) {
        const parsedError = await extractInvokeErrorMessage(error);
        throw new Error(parsedError);
      }

      if (data?.error) throw new Error(data.error);

      const successMessage = data?.message || "تم تسجيل وكيل جديد بنجاح!";
      trackEvent("signup_complete", "/login", { email: signupEmail.trim() });
      toast.success(successMessage);

      const normalizedEmail = signupEmail.trim();
      const { error: autoLoginError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: signupPassword,
      });

      const requiresVerification =
        (autoLoginError as any)?.code === "email_not_confirmed" ||
        autoLoginError?.message?.includes("Email not confirmed");

      if (!autoLoginError) {
        navigate("/", { replace: true });
      } else if (requiresVerification) {
        const bypassed = await tryBypassEmailVerification(normalizedEmail);
        if (bypassed) {
          const { error: retryError } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password: signupPassword,
          });
          if (!retryError) {
            navigate("/", { replace: true });
            return;
          }
        }

        const params = new URLSearchParams({ email: normalizedEmail, p: signupPassword });
        navigate(`/verify-email?${params.toString()}`, { replace: true });
      } else {
        throw new Error(autoLoginError.message || "تم إنشاء الحساب لكن تعذر تسجيل الدخول تلقائياً");
      }
    } catch (e: unknown) {
      const errorMessage = await extractInvokeErrorMessage(e);
      setSignupFeedback({ type: "error", message: errorMessage });
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const siteTitle = "Thiqa";
  const siteDesc = "نظام إدارة التأمين";
  const canSubmitSignup =
    !!fullName.trim() &&
    signupEmail.includes("@") &&
    signupPassword.length >= 6 &&
    signupPassword === signupConfirmPassword &&
    (!signupPhone.trim() || digitsOnly(signupPhone).length === 10) &&
    !loading;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row relative" dir="rtl">
      {/* Mobile background */}
      <div className="fixed inset-0 lg:hidden -z-10">
        <img src={loginBgMobile} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/30 backdrop-blur-md" />
      </div>

      {/* Left panel - background (desktop) */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-1/2 relative items-center justify-center overflow-hidden">
        <img src="/images/thiqa-bg.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-br from-black/40 via-black/20 to-transparent" />
        <div className="relative z-10 text-center space-y-4">
          <img src={thiqaLogo} alt="ثقة" className="mx-auto w-40 h-auto drop-shadow-2xl" />
          <p className="text-white/80 text-lg font-light tracking-wide">نظام إدارة التأمين</p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:bg-gradient-to-br lg:from-muted/40 lg:to-background">
        <div className="w-full max-w-md animate-scale-in">
          <div className="rounded-3xl border border-white/20 bg-white/95 dark:bg-card/95 lg:bg-white/70 lg:dark:bg-card/70 backdrop-blur-xl shadow-2xl shadow-black/10 overflow-hidden">
            {/* Header */}
            <div className="text-center pt-8 sm:pt-10 pb-4 px-5 sm:px-8">
              <img src={thiqaLogoDark} alt={siteTitle} className="mx-auto h-10 w-auto object-contain mb-1" />
              <p className="text-muted-foreground mt-1 text-sm">{siteDesc}</p>
            </div>

            {/* Content */}
            <div className="px-5 sm:px-8 pb-8 sm:pb-10 space-y-5">
              {isInIframe && (
                <Alert className="border-amber-300/60 bg-amber-50/80 dark:bg-amber-900/20 backdrop-blur-sm rounded-xl">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-sm mr-2 text-amber-800 dark:text-amber-200">
                    تسجيل الدخول بـ Google لا يعمل داخل المعاينة.
                  </AlertDescription>
                </Alert>
              )}

              {pageView === "login" ? (
                <>
                  {/* Google Login */}
                  {isInIframe ? (
                    <Button className="w-full h-12 text-base gap-3 rounded-xl bg-foreground hover:bg-foreground/90 text-background shadow-lg" onClick={() => window.open(window.location.origin + '/login', '_blank')}>
                      <ExternalLink className="h-5 w-5" />افتح في تبويب جديد
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full h-12 text-base gap-3 rounded-xl border-border/60 bg-white/60 dark:bg-card/60 backdrop-blur-sm hover:bg-white hover:border-primary/40 transition-all duration-200 shadow-sm"
                      onClick={handleGoogleLogin}
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                        <svg className="h-5 w-5" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                      )}
                      تسجيل الدخول بـ Google
                    </Button>
                  )}

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/40" /></div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-white/70 dark:bg-card/70 backdrop-blur-sm px-3 text-muted-foreground">أو</span>
                    </div>
                  </div>

                  {/* Email/Password Login */}
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="login-email" className="text-sm font-medium">البريد الإلكتروني</Label>
                      <Input id="login-email" type="email" placeholder="your-email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="ltr-input h-11 rounded-xl bg-white/60 dark:bg-card/60 backdrop-blur-sm border-border/60" disabled={loading} dir="ltr" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password" className="text-sm font-medium">كلمة المرور</Label>
                      <div className="relative">
                        <Input id="login-password" type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-xl bg-white/60 dark:bg-card/60 backdrop-blur-sm border-border/60 pl-10" disabled={loading} dir="ltr" />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                   </div>
                    <Button className="w-full h-12 text-base gap-2 rounded-xl shadow-lg flex-row-reverse" onClick={handleEmailPasswordLogin} disabled={loading || !email || !password}>
                      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5 rotate-180" />}
                      {loading ? "جاري تسجيل الدخول..." : "تسجيل الدخول"}
                    </Button>

                    <button
                      type="button"
                      className="w-full text-center text-sm text-primary hover:underline"
                      onClick={() => navigate("/forgot-password")}
                    >
                      نسيت كلمة المرور؟
                    </button>
                  </div>

                  <Separator />

                  <div className="text-center">
                    <p className="text-sm text-muted-foreground mb-2">ليس لديك حساب؟</p>
                    <Button variant="outline" className="w-full h-11 rounded-xl gap-2" onClick={() => setPageView("signup")}>
                      <UserPlus className="h-4 w-4" />
                      إنشاء حساب وكيل جديد
                    </Button>
                  </div>
                </>
              ) : (
                /* Signup Form */
                <>
                  {/* Google Signup */}
                  {!isInIframe && (
                    <>
                      <Button
                        variant="outline"
                        className="w-full h-12 text-base gap-3 rounded-xl border-border/60 bg-white/60 dark:bg-card/60 backdrop-blur-sm hover:bg-white hover:border-primary/40 transition-all duration-200 shadow-sm"
                        onClick={handleGoogleLogin}
                        disabled={loading}
                      >
                        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                          <svg className="h-5 w-5" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                          </svg>
                        )}
                        التسجيل بـ Google
                      </Button>

                      <div className="relative">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/40" /></div>
                        <div className="relative flex justify-center text-xs">
                          <span className="bg-white/70 dark:bg-card/70 backdrop-blur-sm px-3 text-muted-foreground">أو سجّل وكالة جديدة يدوياً</span>
                        </div>
                      </div>
                    </>
                  )}

                  {/* 35-day free trial banner */}
                  <div className="rounded-xl bg-primary/10 border border-primary/20 p-3 text-center">
                    <p className="text-sm font-bold text-primary">🎉 35 يوم مجاناً!</p>
                    <p className="text-xs text-muted-foreground mt-1">لا حاجة لإدخال أي وسيلة دفع — هذا التسجيل ينشئ وكالة جديدة مستقلة</p>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 text-center">
                    <p className="text-xs text-muted-foreground">هذا النموذج مخصص لتسجيل <span className="font-semibold text-foreground">وكالة جديدة</span> فقط، وليس لإضافة مستخدم داخل وكالة موجودة.</p>
                  </div>

                  <div className="space-y-4">
                    {/* Full Name */}
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">الاسم الكامل *</Label>
                      <Input value={fullName} onChange={(e) => { setFullName(e.target.value); setSignupErrors(prev => ({ ...prev, fullName: "" })); setSignupFeedback(null); }} placeholder="مثال: محمد أحمد" className={`h-11 rounded-xl bg-white/60 dark:bg-card/60 border-border/60 ${signupErrors.fullName ? "border-destructive" : ""}`} disabled={loading} />
                      {signupErrors.fullName && <p className="text-xs text-destructive">{signupErrors.fullName}</p>}
                    </div>

                    {/* Email */}
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">البريد الإلكتروني *</Label>
                      <Input type="email" value={signupEmail} onChange={(e) => { setSignupEmail(e.target.value); setSignupErrors(prev => ({ ...prev, signupEmail: "" })); setSignupFeedback(null); }} placeholder="your-email@example.com" className={`h-11 rounded-xl bg-white/60 dark:bg-card/60 border-border/60 ${signupErrors.signupEmail ? "border-destructive" : ""}`} disabled={loading} dir="ltr" />
                      {signupErrors.signupEmail && <p className="text-xs text-destructive">{signupErrors.signupEmail}</p>}
                    </div>

                    {/* Phone */}
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">رقم الهاتف <span className="text-muted-foreground font-normal">(اختياري - 10 أرقام)</span></Label>
                      <Input type="tel" value={signupPhone} onChange={(e) => { setSignupPhone(digitsOnly(e.target.value).slice(0, 10)); setSignupErrors(prev => ({ ...prev, signupPhone: "" })); setSignupFeedback(null); }} placeholder="05xxxxxxxx" className={`h-11 rounded-xl bg-white/60 dark:bg-card/60 border-border/60 ${signupErrors.signupPhone ? "border-destructive" : ""}`} disabled={loading} dir="ltr" maxLength={10} />
                      {signupErrors.signupPhone && <p className="text-xs text-destructive">{signupErrors.signupPhone}</p>}
                    </div>

                    {/* Passwords */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">كلمة المرور *</Label>
                        <Input type="password" value={signupPassword} onChange={(e) => { setSignupPassword(e.target.value); setSignupErrors(prev => ({ ...prev, signupPassword: "" })); setSignupFeedback(null); }} placeholder="6 أحرف على الأقل" className={`h-11 rounded-xl bg-white/60 dark:bg-card/60 border-border/60 ${signupErrors.signupPassword ? "border-destructive" : ""}`} disabled={loading} dir="ltr" autoComplete="new-password" />
                        {signupErrors.signupPassword && <p className="text-xs text-destructive">{signupErrors.signupPassword}</p>}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">تأكيد كلمة المرور *</Label>
                        <Input type="password" value={signupConfirmPassword} onChange={(e) => { setSignupConfirmPassword(e.target.value); setSignupErrors(prev => ({ ...prev, signupConfirmPassword: "" })); setSignupFeedback(null); }} placeholder="أعد إدخال كلمة المرور" className={`h-11 rounded-xl bg-white/60 dark:bg-card/60 border-border/60 ${signupErrors.signupConfirmPassword ? "border-destructive" : ""}`} disabled={loading} dir="ltr" autoComplete="new-password" />
                        {signupErrors.signupConfirmPassword && <p className="text-xs text-destructive">{signupErrors.signupConfirmPassword}</p>}
                      </div>
                    </div>

                    <Button className="w-full h-12 text-base gap-2 rounded-xl shadow-lg" onClick={handleSignup} disabled={!canSubmitSignup}>
                      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
                      {loading ? "جاري التسجيل..." : "تسجيل وكيل جديد"}
                    </Button>

                    {signupFeedback && (
                      <div
                        className={`rounded-xl border p-3 text-sm flex items-start gap-2 ${
                          signupFeedback.type === "success"
                            ? "border-success/30 bg-success/10 text-success"
                            : signupFeedback.type === "error"
                            ? "border-destructive/30 bg-destructive/10 text-destructive"
                            : "border-primary/30 bg-primary/10 text-primary"
                        }`}
                      >
                        {signupFeedback.type === "success" ? (
                          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                        ) : signupFeedback.type === "error" ? (
                          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        ) : (
                          <Info className="h-4 w-4 mt-0.5 shrink-0" />
                        )}
                        <p className="leading-5">{signupFeedback.message}</p>
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div className="text-center">
                    <p className="text-sm text-muted-foreground mb-2">لديك حساب بالفعل؟</p>
                    <Button variant="ghost" className="w-full h-10 rounded-xl" onClick={() => setPageView("login")}>
                      تسجيل الدخول
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
