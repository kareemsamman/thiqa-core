import { useState, useEffect } from "react";
import { AlertTriangle, Pause, Phone, Crown, Check, MessageCircle, Zap, Shield, Rocket, Star, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import thiqaLogoIcon from "@/assets/thiqa-logo-icon.svg";

interface PlanData {
  id: string;
  plan_key: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  monthly_price: number;
  badge: string | null;
  features: { text: string }[];
  sort_order: number;
}

const PLAN_ICONS: Record<string, typeof Rocket> = {
  starter: Zap, basic: Shield, pro: Rocket, custom: Star,
};

export default function SubscriptionExpired() {
  const { signOut } = useAuth();
  const { agent, agentId, isSubscriptionPaused } = useAgentContext();
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [loading, setLoading] = useState(true);
  const [choosing, setChoosing] = useState(false);

  const isPaused = isSubscriptionPaused;
  const isCancelled = agent?.subscription_status === "cancelled";

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("subscription_plans")
          .select("id, plan_key, name, name_ar, description, monthly_price, badge, features, sort_order")
          .eq("is_active", true)
          .order("sort_order");
        if (data) {
          setPlans(data.map((p: any) => ({
            ...p,
            features: (typeof p.features === "string" ? JSON.parse(p.features) : p.features) || [],
          })));
        }
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, []);

  const handleChoosePlan = async (plan: PlanData) => {
    if (!agentId) return;
    setChoosing(true);
    try {
      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setDate(expiresAt.getDate() + 30);

      const { error } = await supabase.from("agents").update({
        plan: plan.plan_key,
        monthly_price: plan.monthly_price,
        subscription_status: "active",
        subscription_started_at: now.toISOString(),
        subscription_expires_at: expiresAt.toISOString(),
        billing_cycle_day: now.getDate(),
        cancelled_at: null,
      }).eq("id", agentId);

      if (error) throw error;
      toast.success(`تم الاشتراك في خطة ${plan.name} بنجاح!`);
      window.location.href = "/";
    } catch (e: any) {
      toast.error(e.message || "فشل في الاشتراك");
      setChoosing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-muted/40 to-background flex items-center justify-center p-4" dir="rtl">
      <div className="max-w-4xl w-full space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="mx-auto h-16 w-16 rounded-xl bg-primary flex items-center justify-center">
            <img src={thiqaLogoIcon} alt="ثقة" className="h-10 w-10 object-contain" />
          </div>

          <div className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
            isPaused ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
          )}>
            {isPaused ? <Pause className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {isPaused ? "تم تعليق حسابك مؤقتاً" :
             isCancelled ? "تم إلغاء اشتراكك" : "انتهت فترة اشتراكك"}
          </div>

          <h1 className="text-2xl md:text-3xl font-bold">
            {isPaused ? "يرجى التواصل مع إدارة ثقة" : "اختر خطة للاستمرار"}
          </h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            {isPaused
              ? "حسابك معلّق مؤقتاً. تواصل مع فريق ثقة لإعادة تفعيل حسابك."
              : "لمواصلة استخدام النظام، اختر إحدى الخطط التالية أو تواصل معنا."}
          </p>
        </div>

        {/* Plans - only show if not paused */}
        {!isPaused && !loading && plans.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const PlanIcon = PLAN_ICONS[plan.plan_key] || Shield;
              return (
                <Card key={plan.id} className="border shadow-sm hover:shadow-md transition-all overflow-hidden">
                  {plan.badge && (
                    <div className="bg-primary text-primary-foreground text-center text-xs font-bold py-1">
                      {plan.badge}
                    </div>
                  )}
                  <CardContent className={cn("pt-6 pb-5 space-y-4", plan.badge && "pt-4")}>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                        <PlanIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg">{plan.name}</h3>
                        {plan.name_ar && <p className="text-xs text-muted-foreground">{plan.name_ar}</p>}
                      </div>
                    </div>

                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-extrabold">₪{plan.monthly_price}</span>
                      <span className="text-sm text-muted-foreground">/ شهرياً</span>
                    </div>

                    {plan.description && (
                      <p className="text-xs text-muted-foreground">{plan.description}</p>
                    )}

                    <ul className="space-y-2">
                      {plan.features.slice(0, 5).map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                          <span>{f.text}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      className="w-full gap-2"
                      onClick={() => handleChoosePlan(plan)}
                      disabled={choosing}
                    >
                      {choosing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
                      اشترك الآن
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Contact + Sign out */}
        <div className="text-center space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="https://wa.me/972525143581" target="_blank" rel="noopener noreferrer">
              <Button className="bg-green-600 hover:bg-green-700 text-white gap-2">
                <MessageCircle className="h-4 w-4" />
                تواصل مع إدارة ثقة
              </Button>
            </a>
            <a href="tel:0525143581">
              <Button variant="outline" className="gap-2">
                <Phone className="h-4 w-4" />
                <span dir="ltr">052-514-3581</span>
              </Button>
            </a>
          </div>

          <Button variant="ghost" onClick={() => signOut()} className="text-muted-foreground">
            تسجيل الخروج
          </Button>
        </div>
      </div>
    </div>
  );
}
