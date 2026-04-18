import { forwardRef, useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/hooks/useAnalyticsTracker";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, AlertCircle, ArrowRight, Eye, EyeOff, UserPlus, CheckCircle2, Info, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import loginBgMobile from "@/assets/login-bg-mobile.png";
import { PublicSEO } from "@/components/public/PublicSEO";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
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

// Playback rate for the background video shown on desktop + mobile.
// The source clip is a gentle ambient loop — a small 1.4× speed-up
// keeps it feeling alive without becoming distracting.
const BACKGROUND_VIDEO_SPEED = 1.4;

// Callback ref that applies `BACKGROUND_VIDEO_SPEED` to any <video>
// element as soon as it mounts. `playbackRate` has to be set on the
// real DOM node (can't be passed as a prop), and setting it in a
// useEffect would miss the first render — callback refs run
// synchronously when the element attaches, so the rate is in effect
// before `autoPlay` kicks off playback.
const setVideoSpeed = (el: HTMLVideoElement | null) => {
  if (el) el.playbackRate = BACKGROUND_VIDEO_SPEED;
};

// Floating-label input. The label sits centered inside the field while
// the input is empty + unfocused, then shrinks and floats to the top
// as soon as the user focuses or types. CSS-only via the `peer` +
// `placeholder-shown` pattern — no React state needed, so it works
// for both controlled and uncontrolled (ref-based) inputs.
type FloatingFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hasError?: boolean;
  endSlot?: ReactNode;
  inputClassName?: string;
};

const FloatingField = forwardRef<HTMLInputElement, FloatingFieldProps>(
  ({ id, label, hasError, endSlot, inputClassName, className, ...inputProps }, ref) => {
    return (
      <div className={cn("relative", className)}>
        <input
          {...inputProps}
          id={id}
          ref={ref}
          // Placeholder must be a non-empty string so :placeholder-shown
          // is true while the field is empty. A single space is invisible.
          placeholder=" "
          className={cn(
            "peer h-12 w-full rounded-xl bg-[#f6f6f9] border border-transparent text-sm text-foreground transition-all",
            "focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "px-4 pt-5 pb-1",
            endSlot && "pl-10",
            hasError && "border-destructive",
            inputClassName,
          )}
        />
        <label
          htmlFor={id}
          className={cn(
            "pointer-events-none absolute right-4 text-muted-foreground transition-all",
            // Default = floating (small, near the top of the field)
            "top-1.5 text-[10px]",
            // Empty + unfocused → centered, full size
            "peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm",
            // Focused → back to floating (overrides placeholder-shown)
            "peer-focus:top-1.5 peer-focus:translate-y-0 peer-focus:text-[10px]",
          )}
        >
          {label}
        </label>
        {endSlot && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center text-muted-foreground">
            {endSlot}
          </div>
        )}
      </div>
    );
  },
);
FloatingField.displayName = "FloatingField";

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const navigate = useNavigate();
  const { user, isActive, isSuperAdmin, loading: authLoading } = useAuth();

  const location = useLocation();

  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  // /register lands on the signup view; /login (with optional
  // ?view=signup for legacy links) honours its query.
  const [pageView, setPageView] = useState<PageView>(() => {
    if (window.location.pathname === "/register") return "signup";
    return searchParams.get("view") === "signup" ? "signup" : "login";
  });

  // The two switch-form cards are <Link>s, so navigation between
  // /login and /register is real router navigation. Login stays
  // mounted across the swap, so we keep pageView in sync with the
  // pathname here instead of toggling it imperatively.
  useEffect(() => {
    setPageView(location.pathname === "/register" ? "signup" : "login");
  }, [location.pathname]);
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // Use refs for password fields to avoid exposing values in DOM
  const loginPasswordRef = useRef<HTMLInputElement>(null);
  const signupPasswordRef = useRef<HTMLInputElement>(null);

  // Signup fields
  const [fullName, setFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  // Track password for strength indicator only (not bound to input value)
  const [signupPasswordDisplay, setSignupPasswordDisplay] = useState("");
  // Marketing-consent checkbox (independent of the required terms +
  // privacy agreement that's implied by submitting the form). Default
  // ON to match the reference design.
  const [marketingConsent, setMarketingConsent] = useState(true);

  // Signup validation errors (shown per-field)
  const [signupErrors, setSignupErrors] = useState<Record<string, string>>({});
  const [signupFeedback, setSignupFeedback] = useState<SignupFeedback | null>(null);

  // Rate limiting
  const [lockoutMessage, setLockoutMessage] = useState("");

  // Google-only account hint
  const [googleHintOpen, setGoogleHintOpen] = useState(false);
  const lastCheckedEmailRef = useRef<string>("");

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

  // On email blur, ask the backend whether this email is a Google-only
  // account. If so, show a dialog nudging the user toward "Sign in with
  // Google" instead of letting them fight with an invalid-credentials error.
  const handleEmailBlur = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) return;
    if (lastCheckedEmailRef.current === normalizedEmail) return;
    lastCheckedEmailRef.current = normalizedEmail;

    try {
      const { data, error } = await supabase.rpc("check_email_provider_public", {
        p_email: normalizedEmail,
      });
      console.info("[login] email provider check", { email: normalizedEmail, data, error });
      if (error) return;
      const result = data as { exists?: boolean; providers?: string[]; is_google_only?: boolean } | null;
      if (result?.is_google_only) {
        setGoogleHintOpen(true);
      }
    } catch (err) {
      console.warn("[login] email provider check failed", err);
    }
  };

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
      <div className="h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const passwordStrength = checkPasswordStrength(signupPasswordDisplay);

  const isSignup = pageView === "signup";
  return (
    <div className="min-h-[100dvh] flex flex-col lg:flex-row-reverse relative bg-white" dir="rtl">
      <PublicSEO
        title={isSignup ? "Thiqa | إنشاء حساب جديد" : "Thiqa | تسجيل الدخول"}
        description={
          isSignup
            ? "انضم إلى Thiqa وابدأ بإدارة وكالة التأمين خاصتك إلكترونياً. تجربة مجانية 35 يوم بدون بطاقة ائتمان."
            : "سجّل دخولك إلى Thiqa لإدارة عملاء وكالتك ووثائقك وأقساطك ومدفوعاتك في مكان واحد."
        }
        keywords={isSignup ? "تسجيل في Thiqa, إنشاء حساب, اشتراك مجاني, نظام تأمين" : "تسجيل دخول Thiqa, دخول للنظام"}
      />
      {/* Mobile video banner — short (15vh) strip at the top of the
          screen with the white Thiqa lockup centered on top. Hidden
          on lg+ since the desktop left panel already shows the same
          video + brand. */}
      <div className="lg:hidden relative w-full h-[15vh] overflow-hidden flex-shrink-0">
        <video
          ref={setVideoSpeed}
          className="absolute inset-0 w-full h-full object-cover"
          src="https://thiqacrm.b-cdn.net/video.mp4"
          poster={loginBgMobile}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        />
        {/* Soft dark wash so the white logo always reads regardless of
            which frame of the video is showing. */}
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative z-10 h-full flex items-center justify-center text-white">
          <ThiqaLogoAnimation
            iconSize={56}
            interactive={false}
            iconSrc="https://thiqacrm.b-cdn.net/small_white.png"
          />
        </div>
      </div>

      {/* Left panel - background (desktop) */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-1/2 relative items-center justify-center overflow-hidden">
        {/* Background video — autoplay requires muted + playsInline on
            mobile browsers. poster= shows the old still image on slow
            connections until the first frame decodes. */}
        <video
          ref={setVideoSpeed}
          className="absolute inset-0 w-full h-full object-cover"
          src="https://thiqacrm.b-cdn.net/video.mp4"
          poster="/images/thiqa-bg.png"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/40 via-black/20 to-transparent" />
        <div className="relative z-10 flex flex-col items-center text-white">
          {/* Desktop left panel — the animation owns the tagline via
              its `subtitle` prop so both animate as one sequence,
              and click-to-replay is disabled. */}
          <ThiqaLogoAnimation
            iconSize={104}
            interactive={false}
            iconSrc="https://thiqacrm.b-cdn.net/small_white.png"
            subtitle="نظام إدارة التأمين"
            subtitleClassName="text-white/80 text-lg font-light tracking-wide"
          />
        </div>
      </div>

      {/* Form panel — sits on the RIGHT on desktop (flex-row-reverse
          with RTL). Plain white background everywhere, no card chrome
          on either breakpoint: the form reads as text on a clean page
          instead of a floating dialog. Mobile gets a video banner
          above this (rendered earlier). Flex-col layout pushes the
          legal footer to the bottom of the column. */}
      <div className="flex-1 flex flex-col px-5 sm:p-6 bg-white pt-8 lg:pt-14 pb-6">
        <div className="flex-1 flex items-start sm:items-center justify-center w-full">
        <div className="w-full max-w-lg animate-scale-in">
          <div>
            {/* Content */}
            <div className="px-2 sm:px-2 pb-2 space-y-4">
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
                  {/* Page heading — centered on both mobile and desktop.
                      `lg:pt-4` gives the desktop card extra top room
                      above the heading since the desktop card doesn't
                      have the animated logo above it (the big logo
                      lives in the left panel). */}
                  <div className="text-center lg:pt-4 lg:mb-8">
                    <h1 className="text-2xl sm:text-4xl font-bold text-foreground">أهلاً، هيا نبدأ؟</h1>
                    <p className="text-sm text-muted-foreground mt-2 lg:hidden">
                      أدخل بياناتك للمتابعة إلى حسابك
                    </p>
                  </div>

                  {/* Lockout warning */}
                  {lockoutMessage && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
                      <Lock className="h-3.5 w-3.5 shrink-0" />
                      {lockoutMessage}
                    </div>
                  )}

                  {/* Email/Password Login — placed before the Google
                      button so returning users see the familiar form
                      first. Google becomes the secondary option under
                      the "أو" divider. */}
                  <div className="space-y-2.5">
                    <FloatingField
                      id="login-email"
                      label="البريد الإلكتروني"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={handleEmailBlur}
                      disabled={loading || !!lockoutMessage}
                      dir="ltr"
                      autoComplete="email"
                    />
                    <FloatingField
                      ref={loginPasswordRef}
                      id="login-password"
                      label="كلمة المرور"
                      type={showPassword ? "text" : "password"}
                      disabled={loading || !!lockoutMessage}
                      dir="ltr"
                      autoComplete="current-password"
                      endSlot={
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="hover:text-foreground">
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      }
                    />
                    <Button className="w-full h-12 text-sm gap-2 rounded-xl shadow-lg flex-row-reverse" onClick={handleEmailPasswordLogin} disabled={loading || !email || !!lockoutMessage}>
                      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5 rotate-180" />}
                      {loading ? "جاري تسجيل الدخول..." : "تسجيل الدخول"}
                    </Button>

                    <Link
                      to="/forgot-password"
                      className="block w-full text-center text-xs sm:text-sm text-primary hover:underline"
                    >
                      نسيت كلمة المرور؟
                    </Link>
                  </div>

                  {/* "أو" divider + Google button, moved below the
                      email form so Google reads as the alternative. */}
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/40" /></div>
                    <div className="relative flex justify-center text-xs">
                      <span className="px-3 text-muted-foreground">أو</span>
                    </div>
                  </div>

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

                  {/* Switch-form CTA card — full card is a real
                      router <Link> to /register so the entire surface
                      is clickable. The inner button styling lives on
                      a span (since <button> can't nest inside <a>). */}
                  <Link
                    to="/register"
                    className="block rounded-2xl p-3 min-h-[94px] bg-[#f2f3f6] hover:opacity-95 transition-opacity"
                    style={{
                      backgroundImage: "url('https://thiqacrm.b-cdn.net/image%20222.png')",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  >
                    <div className="flex items-center h-full">
                      <div className="flex-1 text-right pr-2">
                        <p className="text-[13px] font-semibold text-black mb-2 leading-tight">
                          وكلاء جدد؟ انضموا إلينا
                        </p>
                        <span className="bg-black text-white text-[12px] font-bold rounded-full px-5 h-9 inline-flex items-center">
                          تسجيل مجاني
                        </span>
                      </div>
                    </div>
                  </Link>
                </>
              ) : (
                /* Signup Form */
                <>
                  {/* Page heading — mirrors the login view's heading
                      style so both views feel like one page. Subtitle
                      stays visible on desktop so the trial offer is
                      always in view. */}
                  <div className="text-center lg:pt-4 lg:mb-6">
                    <h1 className="text-2xl sm:text-4xl font-bold text-foreground">ابدأ مع ثقة</h1>
                    <p className="text-sm text-muted-foreground mt-3">
                      جرّب النظام مجاناً لمدة 35 يوماً — بدون بطاقة ائتمان وبدون التزام.
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    <FloatingField
                      label="الاسم الكامل"
                      value={fullName}
                      onChange={(e) => { setFullName(e.target.value); setSignupErrors(prev => ({ ...prev, fullName: "" })); }}
                      hasError={!!signupErrors.fullName}
                      disabled={loading}
                    />
                    {signupErrors.fullName && <p className="text-[10px] text-destructive pr-1">{signupErrors.fullName}</p>}

                    <FloatingField
                      label="البريد الإلكتروني"
                      type="email"
                      value={signupEmail}
                      onChange={(e) => { setSignupEmail(e.target.value); setSignupErrors(prev => ({ ...prev, signupEmail: "" })); }}
                      hasError={!!signupErrors.signupEmail}
                      disabled={loading}
                      dir="ltr"
                      autoComplete="email"
                    />
                    {signupErrors.signupEmail && <p className="text-[10px] text-destructive pr-1">{signupErrors.signupEmail}</p>}

                    <FloatingField
                      label="رقم الهاتف (اختياري)"
                      type="tel"
                      value={signupPhone}
                      onChange={(e) => { setSignupPhone(digitsOnly(e.target.value).slice(0, 10)); setSignupErrors(prev => ({ ...prev, signupPhone: "" })); }}
                      hasError={!!signupErrors.signupPhone}
                      disabled={loading}
                      dir="ltr"
                      maxLength={10}
                    />
                    {signupErrors.signupPhone && <p className="text-[10px] text-destructive pr-1">{signupErrors.signupPhone}</p>}

                    <FloatingField
                      ref={signupPasswordRef}
                      label="كلمة المرور"
                      type={showSignupPassword ? "text" : "password"}
                      onChange={(e) => { setSignupPasswordDisplay(e.target.value); setSignupErrors(prev => ({ ...prev, signupPassword: "" })); }}
                      hasError={!!signupErrors.signupPassword}
                      disabled={loading}
                      dir="ltr"
                      autoComplete="new-password"
                      endSlot={
                        <button type="button" onClick={() => setShowSignupPassword(!showSignupPassword)} className="hover:text-foreground">
                          {showSignupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      }
                    />
                    {signupErrors.signupPassword && <p className="text-[10px] text-destructive pr-1">{signupErrors.signupPassword}</p>}

                    {/* Password strength indicator */}
                    {signupPasswordDisplay.length > 0 && (
                      <div className="space-y-1 pt-0.5 px-1">
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

                    {/* Implicit terms agreement (just informational
                        text — submitting the form constitutes consent)
                        + opt-in marketing consent checkbox. */}
                    <div className="space-y-2 pt-2">
                      <p className="text-xs text-muted-foreground leading-normal text-start [&_a]:text-foreground" dir="rtl">
                        بالضغط على التسجيل، أوافق على{" "}
                        <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-foreground/80">
                          شروط الاستخدام
                        </a>
                        {" "}وأؤكد أنني قرأت{" "}
                        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-foreground/80">
                          سياسة الخصوصية
                        </a>
                        .
                      </p>
                      <div className="flex items-center justify-start gap-2 text-start" dir="rtl">
                        <Checkbox
                          id="marketing-consent"
                          checked={marketingConsent}
                          onCheckedChange={(v) => setMarketingConsent(v === true)}
                          className="rounded-[4px] border-[1.5px] border-gray-300 data-[state=checked]:border-primary"
                        />
                        <label htmlFor="marketing-consent" className="text-xs text-muted-foreground leading-normal cursor-pointer text-start">
                          أوافق على استلام تحديثات وعروض تسويقية على بريدي الإلكتروني.
                        </label>
                      </div>
                    </div>

                    <Button className="w-full h-12 text-sm gap-2 rounded-xl shadow-lg" onClick={handleSignup} disabled={loading}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                      {loading ? "جاري التسجيل..." : "تسجيل وكيل جديد"}
                    </Button>

                    {/* Google signup — placed AFTER the manual submit
                        button per the new design (alternative path,
                        not the primary CTA). */}
                    {!isInIframe && (
                      <>
                        <div className="relative">
                          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/40" /></div>
                          <div className="relative flex justify-center text-xs">
                            <span className="px-3 text-muted-foreground bg-white lg:bg-white">أو</span>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          className="w-full h-12 text-sm gap-3 rounded-xl border-border/60 bg-white hover:bg-[#f6f6f9] hover:border-primary/40 transition-all duration-200 shadow-sm"
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
                      </>
                    )}

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

                  {/* Switch back to login — full card is a router
                      <Link> to /login. Uses image%20223 so each
                      direction gets its own art. */}
                  <Link
                    to="/login"
                    className="block rounded-2xl p-3 mt-2 min-h-[94px] bg-[#f2f3f6] hover:opacity-95 transition-opacity"
                    style={{
                      backgroundImage: "url('https://thiqacrm.b-cdn.net/image%20223.png')",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  >
                    <div className="flex items-center h-full">
                      <div className="flex-1 text-right pr-2">
                        <p className="text-[13px] font-semibold text-black mb-2 leading-tight">
                          لديك حساب بالفعل؟
                        </p>
                        <span className="bg-black text-white text-[12px] font-bold rounded-full px-5 h-9 inline-flex items-center">
                          تسجيل الدخول
                        </span>
                      </div>
                    </div>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
        </div>

        {/* Legal footer — pushed to the very bottom of the form panel
            via the parent's flex-col + flex-1 spacer above. Same row
            on both login and signup. */}
        <div className="text-center text-[11px] text-muted-foreground pt-6">
          <a href="/terms" className="hover:underline hover:text-foreground transition-colors">شروط الاستخدام</a>
          <span className="mx-2 opacity-50">|</span>
          <a href="/privacy" className="hover:underline hover:text-foreground transition-colors">سياسة الخصوصية</a>
        </div>
      </div>

      {/* Google-only account hint */}
      <Dialog open={googleHintOpen} onOpenChange={setGoogleHintOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              هذا الحساب مسجل بواسطة Google
            </DialogTitle>
            <DialogDescription className="pt-2">
              البريد الإلكتروني الذي أدخلته مرتبط بحساب Google. يرجى تسجيل
              الدخول باستخدام زر Google أدناه بدلاً من كلمة المرور.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setGoogleHintOpen(false)}
              className="flex-1"
            >
              إلغاء
            </Button>
            <Button
              onClick={() => {
                setGoogleHintOpen(false);
                handleGoogleLogin();
              }}
              className="flex-1 gap-2"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              تسجيل الدخول بـ Google
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
