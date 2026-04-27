import { useNavigate } from "react-router-dom";
import { AlertTriangle, Pause, Phone, MessageCircle, ArrowRight, Building2, LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { PlanLadder } from "@/components/pricing/PlanLadder";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import thiqaLogoIcon from "@/assets/thiqa-logo-icon.svg";

// Defaults match the values seeded in the support_contact_settings
// migration — used as a fallback if the settings query hasn't loaded
// yet, so the UI doesn't flash with empty CTAs.
const DEFAULT_SUPPORT_WHATSAPP = "972525143581";
const DEFAULT_SUPPORT_PHONE = "0525143581";

function formatPhoneForDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

/**
 * Lockout page shown when ProtectedRoute determines the agent's
 * subscription is no longer active (trial expired, paid expired,
 * paused, or cancelled). Re-uses the same PlanLadder component the
 * /subscription page renders so the upgrade flow — card grid,
 * "current plan" highlight, PlanChangeConfirmDialog with prorated
 * billing, change-agent-plan edge function — is identical on both
 * surfaces. After a successful plan change we redirect the agent
 * back to /dashboard via a hard reload so the agent context picks
 * up the new active subscription on next mount.
 *
 * The page is in PUBLIC_PATH_PREFIXES (AppChrome bails out for it)
 * so a Thiqa super admin who lands here while impersonating
 * wouldn't see the regular impersonation banner. We render a local
 * banner with the same exit button so they can always return to
 * /thiqa during testing.
 */
export default function SubscriptionExpired() {
  const { signOut } = useAuth();
  const { agent, isSubscriptionPaused, isImpersonating, impersonatedAgent, stopImpersonation } = useAgentContext();
  const navigate = useNavigate();

  const isPaused = isSubscriptionPaused;
  const isCancelled = agent?.subscription_status === "cancelled";

  // Pull WhatsApp + phone numbers from thiqa_platform_settings so a
  // platform admin can update support contact info without a code deploy.
  // Falls back to the seeded defaults to avoid an empty-CTA flash.
  const { data: contact } = useQuery({
    queryKey: ["thiqa-support-contact"],
    queryFn: async () => {
      const { data } = await supabase
        .from("thiqa_platform_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["support_whatsapp", "support_phone"]);
      const map: Record<string, string> = {};
      (data || []).forEach((r) => { map[r.setting_key] = r.setting_value || ""; });
      return map;
    },
  });
  const whatsapp = contact?.support_whatsapp || DEFAULT_SUPPORT_WHATSAPP;
  const phone = contact?.support_phone || DEFAULT_SUPPORT_PHONE;

  const handleExitImpersonation = () => {
    stopImpersonation();
    navigate('/thiqa');
  };

  // After a successful plan change, hard-reload at /dashboard so the
  // agent context refetches with the new (active) subscription state
  // and ProtectedRoute lets the agent through.
  const handlePlanChanged = () => {
    window.location.href = '/dashboard';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-muted/40 to-background flex flex-col" dir="rtl">
      {isImpersonating && impersonatedAgent && (
        <div className="bg-primary text-primary-foreground py-2 px-4 flex items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4" />
            <span>أنت تتصفح نظام الوكيل:</span>
            <span className="font-bold">{impersonatedAgent.name_ar || impersonatedAgent.name}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-white/40 text-white hover:bg-white/10 gap-1"
            onClick={handleExitImpersonation}
          >
            <ArrowRight className="h-3 w-3" />
            العودة للوحة ثقة
          </Button>
        </div>
      )}

      <div className="flex-1 flex items-start justify-center p-4 py-10">
        <div className="max-w-6xl w-full space-y-8">
          {/* Header — status badge + headline + subline. Wording switches
              between paused / cancelled / expired so the user knows
              exactly which state they're in. */}
          <div className="text-center space-y-4">
            <div className="mx-auto h-16 w-16 rounded-xl bg-primary flex items-center justify-center">
              <img src={thiqaLogoIcon} alt="ثقة" className="h-10 w-10 object-contain" />
            </div>

            <div className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
              isPaused ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
            )}>
              {isPaused ? <Pause className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {isPaused ? "تم تعليق حسابك مؤقتاً"
                : isCancelled ? "تم إلغاء اشتراكك"
                : "انتهت فترة اشتراكك"}
            </div>

            <h1 className="text-2xl md:text-3xl font-bold">
              {isPaused ? "يرجى التواصل مع إدارة ثقة" : "اختر خطة للاستمرار"}
            </h1>
            <p className="text-muted-foreground max-w-md mx-auto">
              {isPaused
                ? "حسابك معلّق مؤقتاً. تواصل مع فريق ثقة لإعادة تفعيل حسابك."
                : "لمواصلة استخدام النظام، اختر إحدى الحزم التالية. سيتم إعادتك للوحة التحكم تلقائياً بعد التفعيل."}
            </p>
          </div>

          {/* Plans — only when not paused. Reuses the canonical
              PlanLadder so the picker, confirm dialog and edge-function
              call match the /subscription page exactly. */}
          {!isPaused && (
            <PlanLadder onPlanChanged={handlePlanChanged} />
          )}

          {/* Contact CTAs */}
          <div className="text-center space-y-6">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                <Button className="bg-green-600 hover:bg-green-700 text-white gap-2">
                  <MessageCircle className="h-4 w-4" />
                  تواصل مع إدارة ثقة
                </Button>
              </a>
              <a href={`tel:${phone}`}>
                <Button variant="outline" className="gap-2">
                  <Phone className="h-4 w-4" />
                  <span dir="ltr">{formatPhoneForDisplay(phone)}</span>
                </Button>
              </a>
            </div>

            {/* Sign out — promoted from a faded ghost link to a clearly
                visible outline button with destructive accent. /subscription-
                expired is a bare public route with no auth guard, so a
                bare signOut() leaves the user stranded on the same page;
                we have to push to /login ourselves. Hard reload so any
                remaining auth context drops with the navigation. */}
            <div className="pt-4 border-t border-border/60 flex justify-center">
              <Button
                variant="outline"
                size="lg"
                onClick={async () => {
                  await signOut();
                  window.location.href = '/login';
                }}
                className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 font-semibold"
              >
                <LogOut className="h-4 w-4" />
                تسجيل الخروج
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
