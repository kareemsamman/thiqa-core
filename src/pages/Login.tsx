import { useCallback, useEffect, useRef, useState } from "react";
import { trackEvent } from "@/hooks/useAnalyticsTracker";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, AlertCircle, ArrowRight, Eye, EyeOff, UserPlus, CheckCircle2, Info, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import thiqaLogo from "@/assets/thiqa-logo-full.svg";
import thiqaLogoDark from "@/assets/thiqa-logo-dark.svg";
import loginBgMobile from "@/assets/login-bg-mobile.png";
import { Separator } from "@/components/ui/separator";
import { digitsOnly } from "@/lib/validation";
import {
  checkPasswordStrength,
  isPasswordValid,
  validateEmailFormat,
  isLoginLocked,
  recordFailedLogin,
  resetLoginAttempts,
} from "@/lib/authValidation";

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
  const [showPassword, setShowPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // Use refs for password fields to avoid exposing values in DOM
  const loginPasswordRef = useRef<HTMLInputElement>(null);
  const signupPasswordRef = useRef<HTMLInputElement>(null);
  const signupConfirmPasswordRef = useRef<HTMLInputElement>(null);

  // Signup fields
  const [fullName, setFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  // Track password for strength indicator only (not bound to input value)
  const [signupPasswordDisplay, setSignupPasswordDisplay] = useState("");

  // Signup validation errors (shown per-field)
  const [signupErrors, setSignupErrors] = useState<Record<string, string>>({});
  const [signupFeedback, setSignupFeedback] = useState<SignupFeedback | null>(null);

  // Rate limiting
  const [lockoutMessage, setLockoutMessage] = useState("");

  useEffect(() => {
    try { setIsInIframe(window.self !== window.top); } catch { setIsInIframe(true); }
    // Check if already locked out
    const { locked, remainingMinutes } = isLoginLocked();
    if (locked) {
      setLockoutMessage(`تم تجاوز عدد المحاولات المسموح. حاول مجدداً بعد ${remainingMinutes} دقيقة.`);
    }
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
      if (!isSuperAdmin) {
        sessionStorage.setItem('admin_session_active', 'true');
      }

      if (isSuperAdmin) {
        navigate('/thiqa', { replace: true });
        return;
      }

      const checkAndSetupUser = async () => {
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('email_confirmed, agent_id')
            .eq('id', user.id)
            .maybeSingle();

          // If no profile or no agent_id, this might be a Google OAuth user — set them up
          if (!profile || !profile.agent_id) {
            const isGoogleUser = user.app_metadata?.providers?.includes('google') ||
              user.app_metadata?.provider === 'google' ||
              (user.user_metadata as any)?.iss === 'https://accounts.google.com';
            if (isGoogleUser) {
              toast.info("جاري إعداد حسابك...");
              const { data: setupData, error: setupError } = await supabase.functions.invoke("setup-oauth-user");
              if (setupError) {
                console.error('[Login] setup-oauth-user error:', setupError);
                navigate('/no-access', { replace: true });
                return;
              }
              if (setupData?.already_setup && isSuperAdmin) {
                navigate('/thiqa', { replace: true });
                return;
              }
              // Refresh auth to pick up the new profile
              toast.success(setupData?.message || "تم إعداد حسابك بنجاح!");
              navigate('/', { replace: true });
              return;
            }
          }

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
          console.error('[Login] checkAndSetupUser error:', err);
          if (isActive) {
            navigate('/', { replace: true });
          } else {
            navigate('/no-access', { replace: true });
          }
        }
      };

      checkAndSetupUser();
    }
  }, [user, isActive, isSuperAdmin, authLoading, navigate, tryBypassEmailVerification]);

  const handleGoogleLogin = async () => {
    if (isInIframe) { window.open(window.location.href, '_blank'); return; }
    try {
      setLoading(true);
      sessionStorage.setItem('admin_session_active', 'true');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) {
        sessionStorage.removeItem('admin_session_active');
        if (error.message.includes('provider is not enabled')) {
          toast.error("مزود Google غير مفعل.");
        } else {
          toast.error("حدث خطأ في تسجيل الدخول");
        }
      }
    } catch {
      sessionStorage.removeItem('admin_session_active');
      toast.error("حدث خطأ غير متوقع");
    }
    finally { setLoading(false); }
  };

  const handleEmailPasswordLogin = async () => {
    const password = loginPasswordRef.current?.value || "";
    if (!email || !email.includes("@")) { toast.error("يرجى إدخال بريد إلكتروني صحيح"); return; }
    if (!password || password.length < 6) { toast.error("كلمة المرور 6 أحرف على الأقل"); return; }

    // Check rate limiting
    const { locked, remainingMinutes } = isLoginLocked();
    if (locked) {
      setLockoutMessage(`تم تجاوز عدد المحاولات المسموح. حاول مجدداً بعد ${remainingMinutes} دقيقة.`);
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        const isEmailNotConfirmed =
          (error as any)?.code === "email_not_confirmed" ||
          error.message.includes("Email not confirmed");

        if (error.message.includes("Invalid login credentials")) {
          const result = recordFailedLogin();
          if (result.locked) {
            setLockoutMessage("تم تجاوز عدد المحاولات المسموح. حاول مجدداً بعد 15 دقيقة.");
            toast.error("تم قفل الحساب مؤقتاً. حاول بعد 15 دقيقة.");
          } else {
            toast.error(`البريد أو كلمة المرور غير صحيحة. متبقي ${result.attemptsLeft} محاولات.`);
          }
        } else if (isEmailNotConfirmed) {
          toast.info("جاري محاولة تفعيل الحساب تلقائياً...");
          const bypassed = await tryBypassEmailVerification(email.trim());
          if (bypassed) {
            const { error: retryError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
            if (retryError) {
              toast.error("فشل تسجيل الدخول بعد التفعيل");
            } else {
              resetLoginAttempts();
              toast.success("تم تسجيل الدخول بنجاح");
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
      resetLoginAttempts();
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
    } catch { return raw; }
  };

  const extractInvokeErrorMessage = async (rawError: unknown) => {
    if (!(rawError instanceof Error)) return "حدث خطأ غير متوقع";
    const response = (rawError as Error & { context?: Response }).context;
    if (response && typeof response.json === "function") {
      try {
        const payload = await response.clone().json();
        if (payload?.error || payload?.message) return payload.error || payload.message;
      } catch {}
    }
    return extractFunctionMessage(rawError.message);
  };

  const validateSignupForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    const pw = signupPasswordRef.current?.value || "";
    const confirmPw = signupConfirmPasswordRef.current?.value || "";

    // Full name: require first + last
    const nameParts = fullName.trim().split(/\s+/);
    if (!fullName.trim()) {
      errors.fullName = "الاسم الكامل مطلوب";
    } else if (nameParts.length < 2) {
      errors.fullName = "يرجى إدخال الاسم الأول والأخير";
    }

    // Email: strict validation
    const emailError = validateEmailFormat(signupEmail);
    if (emailError) errors.signupEmail = emailError;

    // Phone
    if (signupPhone.trim() && digitsOnly(signupPhone).length !== 10) {
      errors.signupPhone = "رقم الهاتف يجب أن يكون 10 أرقام";
    }

    // Password: strong requirements
    if (!pw) {
      errors.signupPassword = "كلمة المرور مطلوبة";
    } else if (!isPasswordValid(pw)) {
      errors.signupPassword = "كلمة المرور يجب أن تحتوي على 8 أحرف، حرف كبير، رقم، ورمز";
    }

    // Confirm password
    if (!confirmPw) {
      errors.signupConfirmPassword = "تأكيد كلمة المرور مطلوب";
    } else if (pw !== confirmPw) {
      errors.signupConfirmPassword = "كلمة المرور غير متطابقة";
    }

    return errors;
  };

  const handleSignup = async () => {
    setSignupFeedback(null);

    const errors = validateSignupForm();
    setSignupErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const pw = signupPasswordRef.current?.value || "";

    setLoading(true);
    setSignupFeedback({ type: "info", message: "جارٍ إنشاء وكالة جديدة..." });

    try {
      const { data, error } = await supabase.functions.invoke("register-agent", {
        body: {
          first_name: fullName.trim().split(" ")[0] || fullName.trim(),
          last_name: fullName.trim().split(" ").slice(1).join(" ") || "",
          email: signupEmail.trim(),
          password: pw,
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
        password: pw,
      });

      const requiresVerification =
        (autoLoginError as any)?.code === "email_not_confirmed" ||
        autoLoginError?.message?.includes("Email not confirmed");

      if (!autoLoginError) {
        navigate("/", { replace: true });
      } else if (requiresVerification) {
        const bypassed = await tryBypassEmailVerification(normalizedEmail);
        if (bypassed) {
          const { error: retryError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password: pw });
          if (!retryError) { navigate("/", { replace: true }); return; }
        }
        const params = new URLSearchParams({ email: normalizedEmail, p: pw });
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
  const passwordStrength = checkPasswordStrength(signupPasswordDisplay);

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
      <div className="flex-1 flex items-end sm:items-center justify-center pb-6 sm:pb-0 px-5 sm:p-6 lg:bg-gradient-to-br lg:from-muted/40 lg:to-background">
        <div className="w-full max-w-md animate-scale-in">
          <div className="rounded-2xl sm:rounded-3xl border border-white/20 bg-white/95 dark:bg-card/95 lg:bg-white/70 lg:dark:bg-card/70 backdrop-blur-xl shadow-2xl shadow-black/10 overflow-hidden">
            {/* Header */}
            <div className="text-center pt-8 sm:pt-8 pb-3 sm:pb-3 px-6 sm:px-8">
              <img src={thiqaLogoDark} alt={siteTitle} className="mx-auto h-9 sm:h-10 w-auto object-contain" />
              <p className="text-muted-foreground mt-1 text-xs sm:text-sm">{siteDesc}</p>
            </div>

            {/* Content */}
            <div className="px-6 sm:px-8 pb-8 sm:pb-8 space-y-4 sm:space-y-4">
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
                    <Button className="w-full h-11 text-sm gap-3 rounded-xl bg-foreground hover:bg-foreground/90 text-background shadow-lg" onClick={() => window.open(window.location.origin + '/login', '_blank')}>
                      <ExternalLink className="h-5 w-5" />افتح في تبويب جديد
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full h-11 text-sm gap-3 rounded-xl border-border/60 bg-white/60 dark:bg-card/60 hover:bg-white hover:border-primary/40 transition-all duration-200 shadow-sm"
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
                      <span className="px-3 text-muted-foreground">أو</span>
                    </div>
                  </div>

                  {/* Lockout warning */}
                  {lockoutMessage && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                      <Lock className="h-3.5 w-3.5 shrink-0" />
                      {lockoutMessage}
                    </div>
                  )}

                  {/* Email/Password Login */}
                  <div className="space-y-2.5">
                    <div className="space-y-1">
                      <Label htmlFor="login-email" className="text-xs sm:text-sm font-medium">البريد الإلكتروني</Label>
                      <Input id="login-email" type="email" placeholder="your-email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10 text-sm rounded-xl bg-white/60 dark:bg-card/60 border-border/60" disabled={loading || !!lockoutMessage} dir="ltr" autoComplete="email" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="login-password" className="text-xs sm:text-sm font-medium">كلمة المرور</Label>
                      <div className="relative">
                        <input
                          ref={loginPasswordRef}
                          id="login-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          className="flex w-full border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 hover:border-primary/30 disabled:cursor-not-allowed disabled:opacity-50 h-10 rounded-xl bg-white/60 dark:bg-card/60 border-border/60 pl-10"
                          disabled={loading || !!lockoutMessage}
                          dir="ltr"
                          autoComplete="current-password"
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <Button className="w-full h-11 text-sm gap-2 rounded-xl shadow-lg flex-row-reverse" onClick={handleEmailPasswordLogin} disabled={loading || !email || !!lockoutMessage}>
                      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5 rotate-180" />}
                      {loading ? "جاري تسجيل الدخول..." : "تسجيل الدخول"}
                    </Button>

                    <button
                      type="button"
                      className="w-full text-center text-xs sm:text-sm text-primary hover:underline"
                      onClick={() => navigate("/forgot-password")}
                    >
                      نسيت كلمة المرور؟
                    </button>
                  </div>

                  <Separator />

                  <div className="text-center">
                    <p className="text-xs sm:text-sm text-muted-foreground mb-1.5">ليس لديك حساب؟</p>
                    <Button variant="outline" className="w-full h-10 rounded-xl gap-2 text-sm" onClick={() => setPageView("signup")}>
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
                        className="w-full h-10 text-sm gap-2 rounded-xl border-border/60 bg-white/60 dark:bg-card/60 hover:bg-white hover:border-primary/40 transition-all duration-200 shadow-sm"
                        onClick={handleGoogleLogin}
                        disabled={loading}
                      >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                          <svg className="h-4 w-4" viewBox="0 0 24 24">
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
                          <span className="bg-white dark:bg-card px-3 text-muted-foreground">أو سجّل يدوياً</span>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Trial banner */}
                  <div className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-1.5 text-center">
                    <p className="text-[11px] font-bold text-primary">35 يوم مجاناً — تسجيل وكالة جديدة مستقلة</p>
                  </div>

                  <div className="space-y-2">
                    {/* Full Name */}
                    <div className="space-y-0.5">
                      <Label className="text-xs font-medium">الاسم الكامل *</Label>
                      <Input value={fullName} onChange={(e) => { setFullName(e.target.value); setSignupErrors(prev => ({ ...prev, fullName: "" })); }} placeholder="الاسم الأول والأخير" className={`h-9 text-sm rounded-lg bg-white/60 dark:bg-card/60 border-border/60 ${signupErrors.fullName ? "border-destructive" : ""}`} disabled={loading} />
                      {signupErrors.fullName && <p className="text-[10px] text-destructive">{signupErrors.fullName}</p>}
                    </div>

                    {/* Email */}
                    <div className="space-y-0.5">
                      <Label className="text-xs font-medium">البريد الإلكتروني *</Label>
                      <Input type="email" value={signupEmail} onChange={(e) => { setSignupEmail(e.target.value); setSignupErrors(prev => ({ ...prev, signupEmail: "" })); }} placeholder="your-email@example.com" className={`h-9 text-sm rounded-lg bg-white/60 dark:bg-card/60 border-border/60 ${signupErrors.signupEmail ? "border-destructive" : ""}`} disabled={loading} dir="ltr" autoComplete="email" />
                      {signupErrors.signupEmail && <p className="text-[10px] text-destructive">{signupErrors.signupEmail}</p>}
                    </div>

                    {/* Phone */}
                    <div className="space-y-0.5">
                      <Label className="text-xs font-medium">رقم الهاتف <span className="text-muted-foreground font-normal">(اختياري)</span></Label>
                      <Input type="tel" value={signupPhone} onChange={(e) => { setSignupPhone(digitsOnly(e.target.value).slice(0, 10)); setSignupErrors(prev => ({ ...prev, signupPhone: "" })); }} placeholder="05xxxxxxxx" className={`h-9 text-sm rounded-lg bg-white/60 dark:bg-card/60 border-border/60 ${signupErrors.signupPhone ? "border-destructive" : ""}`} disabled={loading} dir="ltr" maxLength={10} />
                      {signupErrors.signupPhone && <p className="text-[10px] text-destructive">{signupErrors.signupPhone}</p>}
                    </div>

                    {/* Password */}
                    <div className="space-y-0.5">
                      <Label className="text-xs font-medium">كلمة المرور *</Label>
                      <div className="relative">
                        <input
                          ref={signupPasswordRef}
                          type={showSignupPassword ? "text" : "password"}
                          placeholder="8 أحرف، حرف كبير، رقم، ورمز"
                          onChange={(e) => { setSignupPasswordDisplay(e.target.value); setSignupErrors(prev => ({ ...prev, signupPassword: "" })); }}
                          className={`flex w-full border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50 h-9 rounded-lg bg-white/60 dark:bg-card/60 pl-10 ${signupErrors.signupPassword ? "border-destructive" : "border-border/60"}`}
                          disabled={loading}
                          dir="ltr"
                          autoComplete="new-password"
                        />
                        <button type="button" onClick={() => setShowSignupPassword(!showSignupPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showSignupPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      {signupErrors.signupPassword && <p className="text-[10px] text-destructive">{signupErrors.signupPassword}</p>}

                      {/* Password strength indicator */}
                      {signupPasswordDisplay.length > 0 && (
                        <div className="space-y-1 pt-0.5">
                          <div className="flex gap-1">
                            {[0, 1, 2, 3].map((i) => (
                              <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < passwordStrength.score ? passwordStrength.color : "bg-border"}`} />
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                            <span className={passwordStrength.checks.minLength ? "text-green-600" : "text-muted-foreground"}>8+ أحرف {passwordStrength.checks.minLength ? "✓" : ""}</span>
                            <span className={passwordStrength.checks.hasUpper ? "text-green-600" : "text-muted-foreground"}>حرف كبير {passwordStrength.checks.hasUpper ? "✓" : ""}</span>
                            <span className={passwordStrength.checks.hasNumber ? "text-green-600" : "text-muted-foreground"}>رقم {passwordStrength.checks.hasNumber ? "✓" : ""}</span>
                            <span className={passwordStrength.checks.hasSymbol ? "text-green-600" : "text-muted-foreground"}>رمز {passwordStrength.checks.hasSymbol ? "✓" : ""}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Confirm Password */}
                    <div className="space-y-0.5">
                      <Label className="text-xs font-medium">تأكيد كلمة المرور *</Label>
                      <input
                        ref={signupConfirmPasswordRef}
                        type="password"
                        placeholder="أعد إدخال كلمة المرور"
                        onChange={() => setSignupErrors(prev => ({ ...prev, signupConfirmPassword: "" }))}
                        className={`flex w-full border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50 h-9 rounded-lg bg-white/60 dark:bg-card/60 ${signupErrors.signupConfirmPassword ? "border-destructive" : "border-border/60"}`}
                        disabled={loading}
                        dir="ltr"
                        autoComplete="new-password"
                      />
                      {signupErrors.signupConfirmPassword && <p className="text-[10px] text-destructive">{signupErrors.signupConfirmPassword}</p>}
                    </div>

                    <Button className="w-full h-10 text-sm gap-2 rounded-xl shadow-lg" onClick={handleSignup} disabled={loading}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      {loading ? "جاري التسجيل..." : "تسجيل وكيل جديد"}
                    </Button>

                    {signupFeedback && (
                      <div
                        className={`rounded-lg border px-2.5 py-2 text-xs flex items-start gap-1.5 ${
                          signupFeedback.type === "success"
                            ? "border-success/30 bg-success/10 text-success"
                            : signupFeedback.type === "error"
                            ? "border-destructive/30 bg-destructive/10 text-destructive"
                            : "border-primary/30 bg-primary/10 text-primary"
                        }`}
                      >
                        {signupFeedback.type === "success" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        ) : signupFeedback.type === "error" ? (
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        ) : (
                          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        )}
                        <p className="leading-4">{signupFeedback.message}</p>
                      </div>
                    )}
                  </div>

                  <div className="text-center pt-0.5">
                    <p className="text-[11px] text-muted-foreground mb-0.5">لديك حساب بالفعل؟</p>
                    <Button variant="ghost" size="sm" className="w-full h-8 rounded-lg text-xs" onClick={() => setPageView("login")}>
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
