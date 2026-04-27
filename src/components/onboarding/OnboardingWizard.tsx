import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { usePermissions, type PermissionKey } from "@/hooks/usePermissions";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Building2,
  Users,
  Car,
  FileText,
  CheckCircle2,
  X,
  ArrowLeft,
  Palette,
  Rocket,
  ListChecks,
  Loader2,
  MapPin,
  Lock,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  targetRoute: string;
  emoji: string;
  /** Plan feature this step's destination needs. If the agent's plan
   *  doesn't include it, the step is locked + clicking opens the
   *  upgrade popup instead of navigating. Mirrors the gates on the
   *  destination's <PermissionRoute> in App.tsx so the onboarding
   *  can't be used as a back-door around them. */
  featureKey?: string;
  /** Per-user permission for the destination. Mirrors the destination's
   *  <PermissionRoute permission="..."> attribute. The wizard is
   *  admin-only and admins bypass permissions, so today this is a
   *  no-op safety net — kept so a future tightening propagates here. */
  permissionKey?: PermissionKey;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "branding",
    title: "العلامة التجارية",
    description: "ارفع شعارك واسم وكالتك",
    icon: <Palette className="h-5 w-5" />,
    targetRoute: "/admin/branding",
    emoji: "🎨",
    permissionKey: "page.branding",
  },
  {
    id: "branches",
    title: "الفروع",
    description: "أضف فروع وكالتك ومواقعها",
    icon: <MapPin className="h-5 w-5" />,
    targetRoute: "/admin/branches",
    emoji: "📍",
    permissionKey: "page.branches",
  },
  {
    id: "companies",
    title: "شركات التأمين",
    description: "أضف الشركات التي تتعامل معها",
    icon: <Building2 className="h-5 w-5" />,
    targetRoute: "/companies",
    emoji: "🏢",
    permissionKey: "page.companies",
  },
  {
    id: "users",
    title: "المستخدمون",
    description: "أضف موظفيك وحدد صلاحياتهم",
    icon: <Users className="h-5 w-5" />,
    targetRoute: "/admin/users",
    emoji: "👥",
    permissionKey: "page.users",
  },
  {
    id: "clients",
    title: "العملاء",
    description: "ابدأ بإضافة عملائك وسياراتهم",
    icon: <Car className="h-5 w-5" />,
    targetRoute: "/clients",
    emoji: "🚗",
    permissionKey: "page.clients",
  },
  {
    id: "policies",
    title: "المعاملات",
    description: "أنشئ أول معاملة تأمين",
    icon: <FileText className="h-5 w-5" />,
    targetRoute: "/policies",
    emoji: "📄",
  },
];

async function detectCompletedSteps(agentId: string): Promise<Set<string>> {
  const done = new Set<string>();
  try {
    const [agentRes, siteSettingsRes, companiesRes, profilesRes, clientsRes, policiesRes, branchesRes] = await Promise.all([
      supabase.from("agents").select("logo_url").eq("id", agentId).single(),
      supabase
        .from("site_settings")
        .select("logo_url")
        .eq("agent_id", agentId)
        .maybeSingle(),
      // Only count user-added companies, not the auto-seeded samples.
      supabase
        .from("insurance_companies")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", agentId)
        .eq("is_seed", false),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("agent_id", agentId),
      supabase.from("clients").select("id", { count: "exact", head: true }).eq("agent_id", agentId),
      supabase.from("policies").select("id", { count: "exact", head: true }).eq("agent_id", agentId),
      supabase.from("branches").select("id", { count: "exact", head: true }).eq("agent_id", agentId),
    ]);

    // Branding is "done" only when the user has actually uploaded a logo.
    // name_ar and site_title/description get auto-populated on signup, so
    // they can't be used as a signal of user activity.
    const brandingReady =
      Boolean(agentRes.data?.logo_url) || Boolean(siteSettingsRes.data?.logo_url);

    if (brandingReady) done.add("branding");
    if ((branchesRes.count ?? 0) > 0) done.add("branches");
    if ((companiesRes.count ?? 0) > 0) done.add("companies");
    if ((profilesRes.count ?? 0) > 1) done.add("users");
    if ((clientsRes.count ?? 0) > 0) done.add("clients");
    if ((policiesRes.count ?? 0) > 0) done.add("policies");
  } catch (e) {
    console.error("Onboarding detection error:", e);
  }
  return done;
}

export function OnboardingWizard() {
  const { user, isAdmin } = useAuth();
  const { agentId, hasFeature, isThiqaSuperAdmin } = useAgentContext();
  const { can } = usePermissions();
  const { showUpgradePrompt } = useUpgradePrompt();
  const navigate = useNavigate();

  // True when the step's destination is reachable by THIS agent. Two
  // gates, mirroring how App.tsx wraps each route:
  //   1. featureKey → plan must include it (impersonating super admin
  //      bypasses, same as PermissionRoute).
  //   2. permissionKey → user-level grant. Admins bypass, so this is
  //      only relevant if a future tightening makes onboarding visible
  //      to non-admins.
  const isStepUnlocked = (step: OnboardingStep) => {
    if (isThiqaSuperAdmin) return true;
    if (step.featureKey && !hasFeature(step.featureKey)) return false;
    if (step.permissionKey && !can(step.permissionKey)) return false;
    return true;
  };
  const [visible, setVisible] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);

  const refreshCompletedSteps = useCallback(async () => {
    if (!agentId) return;
    const done = await detectCompletedSteps(agentId);
    setCompletedSteps(done);
  }, [agentId]);

  // Listen for manual open only (sidebar menu click)
  useEffect(() => {
    const manualOpenHandler = () => {
      setManualOpen(true);
      setReady(true);
      setVisible(true);
      refreshCompletedSteps();
    };

    window.addEventListener("show-onboarding", manualOpenHandler);

    return () => {
      window.removeEventListener("show-onboarding", manualOpenHandler);
    };
  }, [refreshCompletedSteps]);

  // On mount, load onboarding_completed flag and auto-show ONCE for new users
  useEffect(() => {
    if (!user || !isAdmin || !agentId) return;

    (async () => {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", user.id)
          .single();

        const isCompleted = Boolean((profile as any)?.onboarding_completed);
        setOnboardingCompleted(isCompleted);

        // Auto-show once for new users, then mark as shown so it doesn't pop up again
        const sessionKey = `onboarding_shown_${user.id}`;
        const alreadyShownThisSession = sessionStorage.getItem(sessionKey);

        if (!isCompleted && !alreadyShownThisSession) {
          sessionStorage.setItem(sessionKey, "1");
          const done = await detectCompletedSteps(agentId);
          setCompletedSteps(done);
          setReady(true);
          setVisible(true);
          // Mark as completed in DB so it won't auto-show in future sessions
          await supabase.from("profiles").update({ onboarding_completed: true } as any).eq("id", user.id);
          setOnboardingCompleted(true);
        }
      } catch (e) {
        console.error("Onboarding check error:", e);
      }
    })();
  }, [user, isAdmin, agentId]);

  const handleSkip = async () => {
    setVisible(false);
    setManualOpen(false);
  };

  const handleClose = () => {
    setVisible(false);
    setManualOpen(false);
  };

  const handleGoToStep = (step: OnboardingStep) => {
    // Defensive double-check: even though the locked-step button uses a
    // separate handler, this protects against any future caller that
    // might forget to gate. If somehow we receive a locked step here,
    // bounce to the upgrade popup instead of navigating.
    if (!isStepUnlocked(step)) {
      showUpgradePrompt({
        featureLabel: step.title,
        featureKey: step.featureKey,
      });
      return;
    }
    setVisible(false);
    setManualOpen(false);
    navigate(step.targetRoute);
  };

  const handleLockedStepClick = (step: OnboardingStep) => {
    // The wizard stays open behind the upgrade popup so the user can
    // pick another step after dismissing. Same pattern as the locked
    // nav leaves in the sidebar.
    showUpgradePrompt({
      featureLabel: step.title,
      featureKey: step.featureKey,
    });
  };

  const handleSeedData = async () => {
    if (!agentId) return;
    setSeeding(true);
    try {
      const { data, error } = await supabase.functions.invoke('seed-agent-data');
      if (error) throw error;

      const seeded = data?.seeded || {};
      const parts: string[] = [];
      if (seeded.branches) parts.push(`${seeded.branches} فرع`);
      if (seeded.insurance_companies) parts.push(`${seeded.insurance_companies} شركة تأمين`);
      if (seeded.insurance_categories) parts.push(`${seeded.insurance_categories} نوع تأمين`);
      if (seeded.road_services) parts.push(`${seeded.road_services} خدمة طريق`);
      if (seeded.accident_fee_services) parts.push(`${seeded.accident_fee_services} خدمة إعفاء`);

      if (parts.length > 0) {
        toast.success(`تم إضافة بيانات تجريبية: ${parts.join('، ')}`);
        const done = await detectCompletedSteps(agentId);
        setCompletedSteps(done);
      } else {
        toast.info('البيانات التجريبية موجودة مسبقاً');
      }
    } catch (e: any) {
      console.error('Seed error:', e);
      toast.error('فشل في إضافة البيانات التجريبية');
    } finally {
      setSeeding(false);
    }
  };

  if (!visible || !ready) return null;

  const doneCount = ONBOARDING_STEPS.filter(s => completedSteps.has(s.id)).length;
  const progress = (doneCount / ONBOARDING_STEPS.length) * 100;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="relative bg-primary/5 px-6 pt-6 pb-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="absolute left-3 top-3 h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Rocket className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">مرحباً بك! 👋</h2>
              <p className="text-xs text-muted-foreground">دليل إعداد سريع لوكالتك</p>
            </div>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
              {doneCount}/{ONBOARDING_STEPS.length}
            </span>
          </div>
        </div>

        {/* Steps list */}
        <div className="px-4 py-3 space-y-1.5 max-h-[50vh] overflow-y-auto">
          {ONBOARDING_STEPS.map((step) => {
            const isDone = completedSteps.has(step.id);
            const isLocked = !isStepUnlocked(step);

            // Locked variant — brand-purple wash + lock chip,
            // matching the sidebar leaves and the branch list.
            // Click opens the upgrade popup instead of navigating
            // (so the wizard can never be a back-door around plan
            // gates on the destination route). "Done" badge wins
            // visually if both apply, since the user has already
            // completed this step on a previous plan.
            if (isLocked && !isDone) {
              return (
                <button
                  key={step.id}
                  onClick={() => handleLockedStepClick(step)}
                  className="group/locked w-full flex items-center gap-3 p-3 rounded-xl text-right transition-all duration-200 active:scale-[0.98] border border-[#5468c4]/25 bg-gradient-to-l from-[#5468c4]/10 via-[#4158b0]/[0.08] to-[#5468c4]/10 hover:from-[#5468c4]/20 hover:via-[#4158b0]/15 hover:to-[#5468c4]/20"
                >
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-white/60 text-[#4158b0]">
                    <span className="text-lg">{step.emoji}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#3b4f9e]">
                      {step.title}
                    </p>
                    <p className="text-xs truncate text-[#3b4f9e]/70">
                      مفتوح بعد ترقية الباقة
                    </p>
                  </div>

                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md shrink-0 shadow-sm ring-1 ring-white/40 transition-transform group-hover/locked:scale-110"
                    style={{
                      background:
                        'linear-gradient(135deg, #5468c4 0%, #4158b0 50%, #2a3878 100%)',
                    }}
                  >
                    <Lock className="h-3.5 w-3.5 text-white" />
                  </span>
                </button>
              );
            }

            return (
              <button
                key={step.id}
                onClick={() => handleGoToStep(step)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl text-right transition-all duration-200",
                  "hover:bg-muted/80 active:scale-[0.98]",
                  isDone
                    ? "bg-primary/5 border border-primary/20"
                    : "bg-muted/40 border border-transparent hover:border-border"
                )}
              >
                <div className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center shrink-0 text-lg",
                  isDone ? "bg-primary/10" : "bg-muted"
                )}>
                  {isDone ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : (
                    <span>{step.emoji}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-sm font-semibold transition-all",
                    isDone ? "text-primary line-through decoration-2 decoration-primary/60" : "text-foreground"
                  )}>
                    {step.title}
                  </p>
                  <p className={cn("text-xs truncate", isDone ? "text-primary/70 line-through decoration-primary/40" : "text-muted-foreground")}>{step.description}</p>
                </div>

                <ArrowLeft className={cn(
                  "h-4 w-4 shrink-0",
                  isDone ? "text-primary/50" : "text-muted-foreground/50"
                )} />
              </button>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="px-4 pb-4 pt-2 space-y-2 border-t border-border/50">
          <Button
            variant="outline"
            className="w-full h-10 gap-2 text-sm rounded-xl"
            onClick={handleSeedData}
            disabled={seeding}
          >
            {seeding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ListChecks className="h-4 w-4" />
            )}
            {seeding ? 'جاري إضافة البيانات...' : 'إضافة بيانات تجريبية للبداية'}
          </Button>

          {!manualOpen && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
                className="flex-1 text-xs text-muted-foreground h-9"
              >
                تخطي الدليل ولا تعرضه مرة أخرى
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
