import { useState, useEffect } from "react";
import { usePageView, trackEvent } from "@/hooks/useAnalyticsTracker";
import { useNavigate } from "react-router-dom";
import {
  Check, Info, ChevronDown, Menu, X, Play, Sparkles, Star, HelpCircle, MessageSquare,
} from "lucide-react";
import { useLandingContent, ct } from "@/hooks/useLandingContent";
import { supabase } from "@/integrations/supabase/client";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
import { cn } from "@/lib/utils";
import { PublicSEO } from "@/components/public/PublicSEO";

interface PlanData {
  id: string;
  plan_key: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  monthly_price: number;
  yearly_price: number;
  badge: string | null;
  features: { text: string; info: boolean }[];
}

// Fallback plans if DB fetch fails
const FALLBACK_PLANS: PlanData[] = [
  {
    id: "free_trial",
    plan_key: "free_trial",
    name: "Free",
    name_ar: "المجانية",
    description: "ابدأ مجاناً للأبد — مسار مميّز للتجربة الأولى",
    monthly_price: 0,
    yearly_price: 0,
    badge: null,
    features: [
      { text: "حتى 3 معاملات شهرياً", info: true },
      { text: "مستخدم واحد", info: false },
      { text: "إدارة جهات اتصال", info: false },
      { text: "دعم بريدي", info: false },
    ],
  },
  {
    id: "starter",
    plan_key: "starter",
    name: "Starter",
    name_ar: "البداية",
    description: "مناسب للوكلاء المستقلين في بداية الطريق",
    monthly_price: 240,
    yearly_price: 200,
    badge: null,
    features: [
      { text: "إدارة حتى 200 عميل", info: true },
      { text: "إصدار معاملات أساسي", info: true },
      { text: "تقارير مالية شهرية", info: false },
      { text: "دعم عبر البريد الإلكتروني", info: false },
      { text: "استيراد بيانات أساسي", info: true },
      { text: "نسخ احتياطي يومي تلقائي", info: true },
    ],
  },
  {
    id: "basic",
    plan_key: "basic",
    name: "Basic",
    name_ar: "الأساسية",
    description: "مناسب لوكالات التأمين الصغيرة والمتوسطة",
    monthly_price: 240,
    yearly_price: 200,
    badge: "الأكثر شعبية",
    features: [
      { text: "إدارة عملاء بلا حدود", info: true },
      { text: "إصدار معاملات متقدم", info: true },
      { text: "إدارة مطالبات كاملة", info: false },
      { text: "SMS وتذكيرات تلقائية", info: true },
      { text: "تقارير مالية كاملة", info: true },
      { text: "توقيع رقمي", info: true },
    ],
  },
  {
    id: "pro",
    plan_key: "pro",
    name: "Pro",
    name_ar: "الاحترافية",
    description: "مناسب للوكالات الكبيرة مع فريق عمل",
    monthly_price: 240,
    yearly_price: 200,
    badge: null,
    features: [
      { text: "كل ما في Basic", info: false },
      { text: "إدارة فروع وصلاحيات", info: true },
      { text: "API وتكاملات متقدمة", info: true },
      { text: "تقارير مخصصة", info: false },
      { text: "دعم VIP ومدير حساب", info: true },
      { text: "مزامنة شركات التأمين", info: true },
    ],
  },
];

// Number of features visible by default per card. Anything beyond this
// gets revealed by the per-card "عرض جميع الميزات" toggle, mirroring
// the agent-side PlanLadder's compare-style expand.
const VISIBLE_FEATURE_COUNT = 5;

const INFO_CENTER_ITEMS = [
  { title: "كيف يعمل", desc: "شاهد النظام في الخطوات الأساسية", icon: Play, href: "/landing#demo" },
  { title: "الميزات", desc: "كل ما يقدّمه Thiqa للوكلاء", icon: Sparkles, href: "/landing#features" },
  { title: "آراء العملاء", desc: "ماذا يقول عملاؤنا عن النظام", icon: Star, href: "/landing#testimonials" },
  { title: "أسئلة وأجوبة", desc: "إجابات على الاستفسارات الشائعة", icon: HelpCircle, href: "/landing#faq" },
];

const SUPPORT_ITEMS = [
  {
    title: "عرض توضيحي",
    desc: "احجز جلسة تعريفية مع ممثلنا",
    icon: MessageSquare,
    href: "mailto:support@getthiqa.com?subject=طلب%20عرض%20توضيحي",
    filled: true,
  },
  {
    title: "تواصل معنا",
    desc: "هل لديك أسئلة؟ تحدّث معنا",
    icon: HelpCircle,
    href: "mailto:support@getthiqa.com",
    filled: false,
  },
];

export default function Pricing() {
  usePageView("/pricing");
  const { data: content } = useLandingContent();
  const navigate = useNavigate();
  // Per-card billing cycle (Strain-style) — each plan card owns its own
  // monthly/annual toggle state so users can compare cycles side by side
  // without flipping the whole page.
  const [yearlyByPlan, setYearlyByPlan] = useState<Record<string, boolean>>({});
  const isYearly = (key: string) => !!yearlyByPlan[key];
  const toggleYearly = (key: string) =>
    setYearlyByPlan((s) => ({ ...s, [key]: !s[key] }));
  // Per-card "view all features" expand state — same pattern as the
  // agent-side PlanLadder so the marketing/upgrade UX feels consistent.
  const [expandedByPlan, setExpandedByPlan] = useState<Record<string, boolean>>({});
  const isExpanded = (key: string) => !!expandedByPlan[key];
  const toggleExpanded = (key: string) =>
    setExpandedByPlan((s) => ({ ...s, [key]: !s[key] }));
  const [plans, setPlans] = useState<PlanData[]>(FALLBACK_PLANS);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSubmenu, setMobileSubmenu] = useState<"info" | "support" | null>(null);

  useEffect(() => {
    if (!mobileMenuOpen) {
      setMobileSubmenu(null);
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("subscription_plans")
          .select("id, plan_key, name, name_ar, description, monthly_price, yearly_price, badge, features")
          .eq("is_active", true)
          .order("sort_order");
        if (!error && data && data.length > 0) {
          setPlans(data.map((p: any) => ({
            ...p,
            features: (typeof p.features === 'string' ? JSON.parse(p.features) : p.features) || [],
          })));
        }
      } catch {
        // fallback plans already set
      }
    })();
  }, []);

  return (
    <div
      className="min-h-screen text-black overflow-x-hidden bg-white relative"
      dir="rtl"
      style={{ fontFamily: "'Cairo', sans-serif" }}
    >
      <PublicSEO
        title="Thiqa | الأسعار والخطط"
        description="خطط أسعار Thiqa لإدارة وكالات التأمين: ابدأ بالخطة المجانية ووسّع حسب حاجة وكالتك. أسعار شفافة، اشتراكات شهرية وسنوية، وبدون التزامات طويلة."
        keywords="أسعار Thiqa, خطط اشتراك Thiqa, تكلفة نظام إدارة التأمين, اشتراك مجاني, خطة احترافية"
      />
      {/* Page background stays plain white — the Strain-style cards
          carry the visual weight, not a hero gradient. */}

      {/* ═══ Navbar — static light pill, same 3-item structure as the
          landing page. Mobile collapses to login + hamburger + drawer. */}
      <nav className="fixed inset-x-0 top-0 z-50 pointer-events-none mt-3">
        <div
          className="pointer-events-auto flex flex-row-reverse md:flex-row items-center justify-between md:justify-normal px-4 md:px-6 h-14 md:h-16 mx-auto w-[92%] md:w-[75%] max-w-[72rem] rounded-full bg-white/75 backdrop-blur-md shadow-[0_1px_20px_0_rgba(0,0,0,0.10)]"
        >
          {/* Logo */}
          <div className="md:flex-1 md:flex md:justify-start">
            <a href="/landing" className="flex items-center text-black">
              <ThiqaLogoAnimation
                iconSize={32}
                interactive={false}
                iconSrc="https://thiqacrm.b-cdn.net/small_black.png"
              />
            </a>
          </div>

          {/* Desktop menu */}
          <div className="hidden md:flex items-center gap-10 text-[14px] font-medium text-black/75">
            <a href="/pricing" className="text-black">الأسعار</a>

            <div className="relative group">
              <button
                type="button"
                className="inline-flex items-center transition-colors hover:text-black group-hover:text-black"
              >
                مركز المعلومات
              </button>
              <div className="absolute top-full right-1/2 translate-x-1/2 pt-4 invisible opacity-0 translate-y-1 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200">
                <div
                  dir="rtl"
                  className="w-[560px] rounded-2xl bg-white border border-black/[0.06] shadow-[0_18px_48px_-12px_rgba(0,0,0,0.18)] p-3 flex gap-3"
                >
                  <div className="flex-1 flex flex-col">
                    {INFO_CENTER_ITEMS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <a
                          key={item.href}
                          href={item.href}
                          className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-black/[0.03] transition-colors"
                        >
                          <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-black/[0.05] text-black">
                            <Icon className="w-4 h-4" strokeWidth={2.2} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[15px] font-bold text-black leading-tight">{item.title}</div>
                            <div className="text-[13px] text-black/55 mt-0.5 leading-snug">{item.desc}</div>
                          </div>
                        </a>
                      );
                    })}
                  </div>

                  <a
                    href="/register"
                    onClick={() => trackEvent("signup_click", "/pricing:nav-info-card")}
                    className="relative flex-shrink-0 w-[200px] rounded-xl overflow-hidden flex items-center justify-center text-center"
                    style={{
                      background: "linear-gradient(160deg, #3B5AD9 0%, #6A7FD8 55%, #A8B5E6 100%)",
                    }}
                  >
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background:
                          "radial-gradient(circle at 30% 75%, rgba(255,255,255,0.35), transparent 55%)",
                        filter: "blur(14px)",
                      }}
                    />
                    <div className="relative z-10 px-5 py-8 flex flex-col items-center">
                      <img
                        src="https://thiqacrm.b-cdn.net/small_black.png"
                        alt=""
                        className="w-8 h-8 mb-3 opacity-90 invert"
                        aria-hidden="true"
                      />
                      <div className="text-white text-[22px] font-bold leading-tight">
                        اكتشف Thiqa
                      </div>
                      <div className="text-white/80 text-[12px] mt-2 leading-snug">
                        جولة سريعة في النظام
                      </div>
                    </div>
                  </a>
                </div>
              </div>
            </div>

            <div className="relative group">
              <button
                type="button"
                className="inline-flex items-center transition-colors hover:text-black group-hover:text-black"
              >
                الدعم
              </button>
              <div className="absolute top-full right-1/2 translate-x-1/2 pt-4 invisible opacity-0 translate-y-1 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200">
                <div
                  dir="rtl"
                  className="w-[340px] rounded-2xl bg-white border border-black/[0.06] shadow-[0_18px_48px_-12px_rgba(0,0,0,0.18)] p-3"
                >
                  {SUPPORT_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <a
                        key={item.title}
                        href={item.href}
                        className="flex items-center gap-4 rounded-xl px-3 py-3 hover:bg-black/[0.03] transition-colors"
                      >
                        <div className={cn(
                          "flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg",
                          item.filled ? "bg-black text-white" : "bg-black/[0.05] text-black",
                        )}>
                          <Icon className="w-4 h-4" strokeWidth={2.2} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[15px] font-bold text-black leading-tight">{item.title}</div>
                          <div className="text-[13px] text-black/55 mt-0.5 leading-snug">{item.desc}</div>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* CTA cluster */}
          <div className="md:flex-1 flex flex-row-reverse md:flex-row md:justify-end items-center gap-3 md:gap-5">
            <button
              onClick={() => navigate("/login")}
              className="text-[14px] font-semibold text-black/80 hover:text-black transition-colors inline-flex items-center"
            >
              {ct(content, "navbar_login", "تسجيل الدخول")}
            </button>

            <button
              onClick={() => { trackEvent("signup_click", "/pricing"); navigate("/register"); }}
              className="hidden md:inline-flex px-8 py-3 text-[14px] font-bold text-black hover:bg-black/5 transition-all rounded-full"
              style={{
                border: "2px solid rgba(0, 0, 0, 0.22)",
                background: "rgba(255, 255, 255, 0.0)",
                boxShadow: "0 2px 8px 0 rgba(0, 0, 0, 0.06)",
              }}
            >
              {ct(content, "navbar_cta", "احصل على 35 يوم مجاناً")}
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-full text-black hover:bg-black/5 transition-colors"
              aria-label="فتح القائمة"
              aria-expanded={mobileMenuOpen}
            >
              <Menu className="w-6 h-6" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </nav>

      {/* ═══ Mobile drawer — identical pattern to the landing page. */}
      <div
        className={cn(
          "fixed inset-0 z-[60] md:hidden transition-opacity duration-300",
          mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        aria-hidden={!mobileMenuOpen}
      >
        <div
          className="absolute inset-0 bg-black/45 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
        <aside
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-label="قائمة التنقل"
          className={cn(
            "absolute top-0 inset-x-0 bg-white shadow-2xl rounded-b-3xl",
            "flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "max-h-[90vh]",
            mobileMenuOpen ? "translate-y-0" : "-translate-y-full",
          )}
          style={{ fontFamily: "'Cairo', sans-serif" }}
        >
          <div className="flex flex-row-reverse items-center justify-between px-5 h-16">
            <div className="flex items-center text-black">
              <ThiqaLogoAnimation
                iconSize={30}
                interactive={false}
                iconSrc="https://thiqacrm.b-cdn.net/small_black.png"
              />
            </div>
            <div className="flex flex-row-reverse items-center gap-2">
              <button
                onClick={() => { setMobileMenuOpen(false); navigate("/login"); }}
                className="px-5 py-2 text-[14px] font-semibold text-black rounded-full bg-[#f1ece4] hover:bg-[#e8e2d6] transition-colors"
              >
                {ct(content, "navbar_login", "تسجيل الدخول")}
              </button>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="inline-flex items-center justify-center w-10 h-10 rounded-full text-black hover:bg-black/5 transition-colors"
                aria-label="إغلاق القائمة"
              >
                <X className="w-6 h-6" strokeWidth={2.2} />
              </button>
            </div>
          </div>

          <nav className="overflow-y-auto px-5 pt-4">
            <ul className="flex flex-col text-[18px] font-medium text-black">
              <li className="border-t border-black/10">
                <a
                  href="/pricing"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between py-5 hover:text-black/70 transition-colors"
                >
                  <span>الأسعار</span>
                </a>
              </li>

              <li className="border-t border-black/10">
                <button
                  type="button"
                  onClick={() => setMobileSubmenu((s) => (s === "info" ? null : "info"))}
                  className="w-full flex items-center justify-between py-5 hover:text-black/70 transition-colors"
                  aria-expanded={mobileSubmenu === "info"}
                >
                  <span>مركز المعلومات</span>
                  <ChevronDown
                    className={cn(
                      "w-5 h-5 transition-transform duration-200",
                      mobileSubmenu === "info" && "rotate-180",
                    )}
                    strokeWidth={2.2}
                  />
                </button>
                <div
                  className={cn(
                    "grid transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    mobileSubmenu === "info" ? "grid-rows-[1fr] opacity-100 pb-4" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <ul className="flex flex-col gap-1">
                      {INFO_CENTER_ITEMS.map((item) => {
                        const Icon = item.icon;
                        return (
                          <li key={item.href}>
                            <a
                              href={item.href}
                              onClick={() => setMobileMenuOpen(false)}
                              className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-black/[0.03] transition-colors"
                            >
                              <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-black/[0.05] text-black">
                                <Icon className="w-4 h-4" strokeWidth={2.2} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[15px] font-bold text-black leading-tight">{item.title}</div>
                                <div className="text-[13px] text-black/55 mt-0.5 leading-snug">{item.desc}</div>
                              </div>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </li>

              <li className="border-t border-b border-black/10">
                <button
                  type="button"
                  onClick={() => setMobileSubmenu((s) => (s === "support" ? null : "support"))}
                  className="w-full flex items-center justify-between py-5 hover:text-black/70 transition-colors"
                  aria-expanded={mobileSubmenu === "support"}
                >
                  <span>الدعم</span>
                  <ChevronDown
                    className={cn(
                      "w-5 h-5 transition-transform duration-200",
                      mobileSubmenu === "support" && "rotate-180",
                    )}
                    strokeWidth={2.2}
                  />
                </button>
                <div
                  className={cn(
                    "grid transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    mobileSubmenu === "support" ? "grid-rows-[1fr] opacity-100 pb-4" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <ul className="flex flex-col gap-1">
                      {SUPPORT_ITEMS.map((item) => {
                        const Icon = item.icon;
                        return (
                          <li key={item.title}>
                            <a
                              href={item.href}
                              onClick={() => setMobileMenuOpen(false)}
                              className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-black/[0.03] transition-colors"
                            >
                              <div className={cn(
                                "flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg",
                                item.filled ? "bg-black text-white" : "bg-black/[0.05] text-black",
                              )}>
                                <Icon className="w-4 h-4" strokeWidth={2.2} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[15px] font-bold text-black leading-tight">{item.title}</div>
                                <div className="text-[13px] text-black/55 mt-0.5 leading-snug">{item.desc}</div>
                              </div>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </li>
            </ul>
          </nav>

          <div className="px-5 pt-6 pb-7">
            <button
              onClick={() => { trackEvent("signup_click", "/pricing"); setMobileMenuOpen(false); navigate("/register"); }}
              className="w-full py-4 text-[15px] font-bold text-white bg-black rounded-full hover:bg-black/90 transition-all shadow-[0_6px_20px_-6px_rgba(0,0,0,0.4)]"
            >
              {ct(content, "navbar_cta", "احصل على 35 يوم مجاناً")}
            </button>
          </div>
        </aside>
      </div>

      {/* ═══ Pricing Hero — plain white background; copy is dark for
          contrast on the white page. */}
      <section className="relative z-10 pt-32 md:pt-40 pb-12 md:pb-16 text-center px-6">
        <p className="text-sm text-black/55 mb-4 tracking-wide font-medium">
          {ct(content, "pricing_label", "الأسعار")}
        </p>
        <h1 className="text-[2rem] md:text-[3rem] lg:text-[3.4rem] font-bold mb-5 leading-[1.15] text-black">
          {ct(content, "pricing_title", "جرّب نظام إدارة وكالات التأمين لمدة 35 يوم مجاناً *")}
        </h1>
        <p className="text-black/65 text-[15px] md:text-base max-w-xl mx-auto leading-relaxed">
          {ct(content, "pricing_subtitle", "* جميع الميزات مفتوحة بالكامل — بدون بطاقة ائتمان.")}
        </p>
      </section>

      {/* ═══ Pricing Cards — white on white body, each card has a soft
          shadow to lift off the page. The card with a `badge` gets a
          violet pill on top plus a slight ring so the "most popular"
          option reads instantly. */}
      <section className="relative z-10 pb-24 px-4 md:px-6" aria-labelledby="pricing-plans-heading">
        {/* Visually subtle but semantically real H2 — gives the
            document a proper H1 → H2 → H3 outline for crawlers. */}
        <h2 id="pricing-plans-heading" className="sr-only">
          خطط أسعار Thiqa
        </h2>
        <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6 pt-4">
          {plans.map((plan) => {
            const isPopular = !!plan.badge;
            const isFree = plan.monthly_price === 0;
            const yearly = isYearly(plan.plan_key);
            const hasYearly = !isFree && plan.yearly_price > 0;
            const yearlyAsMonthly = hasYearly ? plan.yearly_price : plan.monthly_price;
            const annualSavings = hasYearly
              ? Math.max(0, (plan.monthly_price - plan.yearly_price) * 12)
              : 0;
            const displayPrice = isFree
              ? 0
              : yearly && hasYearly
                ? yearlyAsMonthly
                : plan.monthly_price;
            const expanded = isExpanded(plan.plan_key);
            const overflowsLimit = plan.features.length > VISIBLE_FEATURE_COUNT;
            const visibleFeatures = expanded || !overflowsLimit
              ? plan.features
              : plan.features.slice(0, VISIBLE_FEATURE_COUNT);
            return (
              <div
                key={plan.id}
                className={cn(
                  "relative rounded-2xl bg-white flex flex-col p-7 md:p-8 transition-all",
                  isPopular
                    ? "ring-2 ring-[#7C5CFF] shadow-[0_18px_60px_-18px_rgba(124,92,255,0.35)]"
                    : "ring-1 ring-black/[0.08] shadow-[0_10px_40px_-18px_rgba(15,40,120,0.18)] hover:ring-black/[0.16]",
                )}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3.5 py-1.5 text-[11px] font-bold rounded-full bg-[#7C5CFF] text-white shadow-md whitespace-nowrap">
                    <Sparkles className="h-3.5 w-3.5" />
                    {plan.badge}
                  </div>
                )}

                {/* Header — Arabic name (with English label below) + description */}
                <div>
                  <h3 className="text-2xl font-extrabold text-black tracking-tight">
                    {plan.name_ar || plan.name}
                  </h3>
                  <p className="text-[11px] text-black/45 mt-1 uppercase tracking-[0.18em] font-semibold">
                    {plan.name}
                  </p>
                  {plan.description && (
                    <p className="text-[13px] text-black/60 mt-2 leading-relaxed min-h-[2.6em]">
                      {plan.description}
                    </p>
                  )}
                </div>

                {/* Price */}
                <div className="mt-6">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-5xl font-black text-black tracking-tight tabular-nums leading-none">
                      {isFree ? "0" : displayPrice}
                    </span>
                    <span className="text-2xl font-bold text-black/80">₪</span>
                    {!isFree && (
                      <span className="text-sm text-black/55 font-semibold">/ شهر</span>
                    )}
                  </div>
                  {isFree ? (
                    <p className="text-[12px] text-black/50 mt-2">للأبد. بدون التزامات.</p>
                  ) : yearly && hasYearly ? (
                    <p className="text-[12px] text-emerald-600 mt-2 font-semibold">
                      وفّر ₪{annualSavings} عند الدفع السنوي
                    </p>
                  ) : (
                    <p className="text-[12px] text-black/50 mt-2">فوترة شهرية</p>
                  )}
                </div>

                {/* Per-card billing toggle (paid plans only) */}
                {hasYearly && (
                  <div className="mt-4 flex items-center justify-between rounded-xl bg-black/[0.04] px-3.5 py-2.5">
                    <span className="text-[13px] font-semibold text-black/70">
                      {yearly ? "فوترة سنوية" : "فوترة شهرية"}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleYearly(plan.plan_key)}
                      className={cn(
                        "relative w-11 h-6 rounded-full transition-colors shrink-0",
                        yearly ? "bg-[#7C5CFF]" : "bg-black/15",
                      )}
                      aria-pressed={yearly}
                      role="switch"
                      aria-checked={yearly}
                      aria-label="تبديل الفوترة السنوية"
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                          yearly ? "right-0.5" : "left-0.5",
                        )}
                      />
                    </button>
                  </div>
                )}

                {/* CTA — black pill, sits before the feature list (Strain) */}
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => {
                      trackEvent("signup_click", `/pricing:${plan.plan_key}`);
                      navigate("/register");
                    }}
                    className={cn(
                      "w-full py-3.5 rounded-full font-bold text-[14px] transition-all hover:scale-[1.02]",
                      isPopular || !isFree
                        ? "bg-black text-white hover:shadow-[0_10px_28px_-8px_rgba(0,0,0,0.4)]"
                        : "bg-white text-black border border-black/[0.18] hover:bg-black/[0.04]",
                    )}
                  >
                    {isFree ? "ابدأ مجاناً" : `انضم لخطة ${plan.name}`}
                  </button>
                </div>

                {/* What's in the path? */}
                <div className="mt-6 pt-6 border-t border-black/[0.06] flex-1">
                  <p className="font-bold text-[13px] text-black mb-3.5">ماذا تشمل هذه الخطة؟</p>
                  <ul className="space-y-3">
                    {visibleFeatures.map((f, i) => (
                      <li key={i} className="flex items-center gap-2.5 text-[13.5px] text-black/75">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#7C5CFF]/12 shrink-0">
                          <Check className="h-3 w-3 text-[#7C5CFF]" strokeWidth={3} />
                        </span>
                        <span className="flex-1">{f.text}</span>
                        {f.info && <Info className="h-3.5 w-3.5 text-black/25 shrink-0" />}
                      </li>
                    ))}
                  </ul>
                  {overflowsLimit && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(plan.plan_key)}
                      className="mt-4 inline-flex items-center justify-center gap-1.5 text-[13px] font-bold text-[#7C5CFF] hover:text-[#5a3fd9] transition-colors"
                    >
                      {expanded
                        ? "إخفاء التفاصيل"
                        : `عرض جميع الميزات (+${plan.features.length - VISIBLE_FEATURE_COUNT})`}
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 transition-transform",
                          expanded && "rotate-180",
                        )}
                        strokeWidth={2.5}
                      />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ═══ Footer — same 4-column desktop grid / mobile accordion
          pattern as the landing page. */}
      <footer className="relative z-10 border-t border-black/[0.08] pt-16 pb-0 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          {(() => {
            const sections = [
              {
                title: "كيف تبدأ؟",
                items: [
                  { label: "جرّب مجاناً", href: "/register" },
                  { label: "تسجيل الدخول", href: "/login" },
                ],
              },
              {
                title: "مركز المعلومات",
                items: [
                  { label: "الأسعار", href: "/pricing" },
                  { label: "كيف يعمل", href: "/landing#demo" },
                  { label: "الميزات", href: "/landing#features" },
                  { label: "أسئلة وأجوبة", href: "/landing#faq" },
                ],
              },
              {
                title: "الدعم والمساعدة",
                items: [
                  { label: "عرض توضيحي", href: "mailto:support@getthiqa.com?subject=طلب%20عرض%20توضيحي" },
                  { label: "تواصل معنا", href: "mailto:support@getthiqa.com" },
                ],
              },
              {
                title: "شروط وسياسات",
                items: [
                  { label: "شروط الاستخدام", href: "/terms" },
                  { label: "سياسة الخصوصية", href: "/privacy" },
                ],
              },
            ];
            return (
              <>
                <div className="hidden md:grid grid-cols-4 gap-8 text-right">
                  {sections.map((section) => (
                    <div key={section.title}>
                      <h4 className="text-[15px] font-bold text-black mb-5">{section.title}</h4>
                      <ul className="space-y-3">
                        {section.items.map((item) => (
                          <li key={item.label}>
                            <a
                              href={item.href}
                              className="text-[14px] text-black/60 hover:text-black transition-colors"
                            >
                              {item.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="md:hidden flex flex-col divide-y divide-black/[0.06]">
                  {sections.map((section) => (
                    <details key={section.title} className="group py-6">
                      <summary className="flex items-center justify-between cursor-pointer list-none">
                        <span className="text-lg font-bold text-black">{section.title}</span>
                        <span className="text-black/40 text-2xl font-light group-open:hidden">+</span>
                        <span className="text-black/40 text-2xl font-light hidden group-open:inline">−</span>
                      </summary>
                      <ul className="mt-4 space-y-3 text-sm text-black/55 text-right">
                        {section.items.map((item) => (
                          <li key={item.label}>
                            <a href={item.href} className="hover:text-black/80 transition-colors">{item.label}</a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </>
            );
          })()}

          <div className="flex items-center gap-3 mt-10 mb-6">
            <div className="h-1.5 w-1.5 rounded-full bg-black/20" />
            <div className="flex-1 h-px bg-black/[0.08]" />
            <div className="h-1.5 w-1.5 rounded-full bg-black/20" />
          </div>

          <p className="text-sm text-black/50 text-center mb-8">
            © Thiqa {new Date().getFullYear()} جميع الحقوق محفوظة
          </p>
        </div>

        <div className="w-full overflow-hidden">
          <img
            src="https://thiqacrm.b-cdn.net/Group%201000011511.png"
            alt="Thiqa"
            className="w-full h-auto block"
            loading="lazy"
          />
        </div>
      </footer>
    </div>
  );
}
