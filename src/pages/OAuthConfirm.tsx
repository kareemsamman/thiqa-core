import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, Mail, ShieldCheck, UserPlus, AlertCircle, Check, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Inline Google "G" so we don't have to ship a brand asset for one icon.
function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.12A6.6 6.6 0 0 1 5.5 12c0-.74.13-1.46.34-2.12V7.04H2.18A10.99 10.99 0 0 0 1 12c0 1.78.43 3.46 1.18 4.96l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

// Stable color palette for the initial-circle fallback so the same
// email always picks the same color (less jarring on re-mount).
const AVATAR_PALETTE = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-indigo-500",
];
function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function getInitial(name: string): string {
  const t = name.trim();
  return t ? t[0] : "?";
}

export default function OAuthConfirm() {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading, profileLoading, signOut, refreshProfile, isSuperAdmin } = useAuth();
  const { refetchAgentContext } = useAgentContext();
  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Read intent set by the Google button on the Login page. If absent
  // (user hit /oauth-confirm directly or sessionStorage was cleared),
  // default to "signup" — confirming details before account creation
  // is the safer fallback than auto-creating.
  const intent = useMemo<"login" | "signup">(() => {
    if (typeof window === "undefined") return "signup";
    const v = sessionStorage.getItem("oauth_intent");
    return v === "login" ? "login" : "signup";
  }, []);

  // Pull what Google returned. Supabase puts it under user_metadata
  // when the OAuth provider populates it.
  const meta = (user?.user_metadata as Record<string, unknown> | undefined) || {};
  const fullName = (meta.full_name as string) || (meta.name as string) || user?.email?.split("@")[0] || "";
  const avatarUrl = (meta.avatar_url as string) || (meta.picture as string) || null;
  const email = user?.email || "";

  // If auth is still resolving, wait. If there's no user at all, the
  // session never settled — bounce back to login.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login", { replace: true });
    }
  }, [authLoading, user, navigate]);

  // Super-admins never need this page — they don't belong to an agent
  // (so they always look "unset" by the agent_id check) but they're
  // already fully provisioned. Forward them to /thiqa.
  useEffect(() => {
    if (authLoading) return;
    if (isSuperAdmin) {
      sessionStorage.removeItem("oauth_intent");
      navigate("/thiqa", { replace: true });
    }
  }, [authLoading, isSuperAdmin, navigate]);

  // If the user already has an agent_id, they're not new — skip
  // straight to the dashboard. Covers refreshes after setup completed.
  useEffect(() => {
    if (authLoading) return;
    if (profile?.agent_id) {
      sessionStorage.removeItem("oauth_intent");
      navigate("/dashboard", { replace: true });
    }
  }, [authLoading, profile?.agent_id, navigate]);

  const handleProceed = async () => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("setup-oauth-user");
      if (error) {
        console.error("[OAuthConfirm] setup-oauth-user error:", error);
        toast.error("تعذّر إعداد الحساب. حاول مجدداً.");
        return;
      }
      // setup-oauth-user inserted profile + agent_users + user_roles +
      // agent_feature_flags. The client-side contexts are still on
      // pre-setup snapshots — refresh both before nav, otherwise
      // PermissionRoute on /dashboard reads hasFeature('dashboard')=
      // false and bounces to /subscription.
      await Promise.all([refreshProfile(), refetchAgentContext()]);
      sessionStorage.removeItem("oauth_intent");
      toast.success(data?.message || "تم إنشاء حسابك بنجاح!");
      navigate("/dashboard", { replace: true });
    } catch (e: any) {
      console.error("[OAuthConfirm] proceed error:", e);
      toast.error(e?.message || "حدث خطأ غير متوقع");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setSigningOut(true);
    try {
      sessionStorage.removeItem("oauth_intent");
      await signOut();
      navigate("/login", { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  // Stay in the loader while:
  //  - auth or profile is still resolving — otherwise existing users
  //    (whose agent_id arrives a tick after the page mounts) flash the
  //    misleading "حسابك غير موجود" message before the agent_id useEffect
  //    above navigates them to /dashboard;
  //  - super-admin (handled by separate useEffect, but render-gate too);
  //  - profile already has agent_id (about to redirect to /dashboard).
  if (authLoading || profileLoading || !user || isSuperAdmin || profile?.agent_id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isLoginNotFound = intent === "login";
  const initialColor = colorForKey(email || fullName || "x");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-md border shadow-lg animate-scale-in">
        <CardHeader className="text-center space-y-4">
          {/* Status icon */}
          <div
            className={
              isLoginNotFound
                ? "mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/30"
                : "mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/30"
            }
          >
            {isLoginNotFound ? (
              <AlertCircle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            ) : (
              <UserPlus className="h-8 w-8 text-primary" />
            )}
          </div>
          <div>
            <CardTitle className="text-2xl font-bold text-foreground">
              {isLoginNotFound ? "حسابك غير موجود" : "تأكيد بياناتك"}
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-2">
              {isLoginNotFound
                ? "لم نعثر على حساب مرتبط بهذا البريد الإلكتروني"
                : "هذه هي البيانات التي استلمناها من Google"}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* "Signed in with Google" pill */}
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <GoogleG className="h-3.5 w-3.5" />
            <span>تم تسجيل الدخول عبر Google</span>
          </div>

          {/* Profile preview — Google account-chooser style: avatar
              on the left, name + email stacked on the right. We force
              LTR direction on this card so the layout matches Google's
              UI regardless of the page's RTL context. */}
          <div className="rounded-xl border bg-secondary/40 p-4 flex items-center gap-3" dir="ltr">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={fullName}
                referrerPolicy="no-referrer"
                className="h-12 w-12 rounded-full object-cover border bg-background shrink-0"
              />
            ) : (
              <div
                className={`h-12 w-12 rounded-full flex items-center justify-center text-white text-lg font-semibold shrink-0 ${initialColor}`}
                aria-label={fullName}
              >
                {getInitial(fullName)}
              </div>
            )}
            <div className="flex-1 min-w-0 text-left">
              {fullName && (
                <div className="font-semibold text-foreground truncate">{fullName}</div>
              )}
              <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{email}</span>
              </div>
            </div>
          </div>

          {/* Body copy */}
          {isLoginNotFound ? (
            <div className="space-y-2 text-sm text-muted-foreground text-center">
              <p>
                ليس لديك حساب في ثقة بهذا البريد بعد. يمكنك إنشاء حساب جديد الآن باستخدام
                نفس بيانات Google، أو العودة إلى صفحة تسجيل الدخول لتجربة بريد آخر.
              </p>
              <p className="text-xs">
                إذا لم ترغب في المتابعة، يمكنك سحب صلاحيات Google من{" "}
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  حساب Google
                  <ExternalLink className="h-3 w-3" />
                </a>
                .
              </p>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground text-right">
              <div className="flex items-start gap-2">
                <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>سيتم إنشاء وكالة جديدة باسمك تبدأ بفترة تجربة مجانية لمدة 35 يوماً.</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>لن نصل إلى أي بيانات في حساب Google غير الاسم والبريد الإلكتروني والصورة.</span>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <span>يمكنك إلغاء الحساب أو سحب صلاحيات Google في أي وقت.</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              onClick={handleProceed}
              disabled={submitting || signingOut}
              className="w-full gap-2 h-11"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {!submitting && <UserPlus className="h-4 w-4" />}
              {isLoginNotFound ? "إنشاء حساب جديد بهذا البريد" : "متابعة وإنشاء الحساب"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={submitting || signingOut}
              className="w-full gap-2 h-11"
            >
              {signingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {isLoginNotFound ? "العودة لتسجيل الدخول" : "إلغاء"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
