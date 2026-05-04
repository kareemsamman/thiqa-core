import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageView, trackEvent } from "@/hooks/useAnalyticsTracker";
import { useNavigate } from "react-router-dom";
import {
  Check, CheckCircle, ChevronDown, Menu, X, Play, Sparkles, Star, HelpCircle, MessageSquare,
  Users, FileText, Mail, Megaphone, Bot, Building2,
  type LucideIcon,
} from "lucide-react";
import { useLandingContent, ct } from "@/hooks/useLandingContent";
import { supabase } from "@/integrations/supabase/client";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
import { cn } from "@/lib/utils";
import { PublicSEO } from "@/components/public/PublicSEO";
import { BreadcrumbJsonLd, PricingJsonLd } from "@/components/public/PublicJsonLd";
import { PLAN_FEATURE_CATALOG } from "@/lib/planFeatureCatalog";
import { FAQSection } from "@/components/public/FAQSection";
import { DemoCallTrigger } from "@/components/public/DemoCallDialog";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicGradientBackground } from "@/components/public/PublicGradientBackground";

interface PlanData {
  id: string;
  plan_key: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  monthly_price: number;
  yearly_price: number;
  badge: string | null;
  users_limit: number | null;
  branches_limit: number | null;
  policies_limit: number | null;
  sms_limit: number;
  marketing_sms_limit: number;
  ai_limit: number;
  default_features: Record<string, boolean>;
}

function formatLimit(limit: number | null | undefined): string {
  if (limit === null || limit === undefined) return 'غير محدود';
  if (limit === 0) return '—';
  return `${limit}`;
}

// Default-features map used by the fallback plans. Keys come from
// PLAN_FEATURE_CATALOG; the higher the plan the more flags flip on.
const ALL_FEATURE_KEYS = PLAN_FEATURE_CATALOG.flatMap((g) => g.items.map((i) => i.key));
const fillFeatures = (keys: string[]): Record<string, boolean> => {
  const map: Record<string, boolean> = {};
  for (const k of ALL_FEATURE_KEYS) map[k] = keys.includes(k);
  return map;
};

// Fallback plans if DB fetch fails. Limits + default_features mirror
// `subscription_plans` columns so the rendering path is identical
// whether data is live or fallback.
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
    users_limit: 1, branches_limit: 1, policies_limit: 10,
    sms_limit: 0, marketing_sms_limit: 0, ai_limit: 0,
    default_features: fillFeatures(["dashboard", "contacts", "renewals", "notifications"]),
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
    users_limit: 1, branches_limit: 1, policies_limit: 30,
    sms_limit: 50, marketing_sms_limit: 0, ai_limit: 0,
    default_features: fillFeatures([
      "dashboard", "tasks", "contacts", "renewals", "notifications",
      "files_upload", "files_explorer", "sms", "receipts",
    ]),
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
    users_limit: 3, branches_limit: 1, policies_limit: 70,
    sms_limit: 100, marketing_sms_limit: 200, ai_limit: 0,
    default_features: fillFeatures([
      "dashboard", "tasks", "contacts", "accident_reports", "correspondence",
      "renewals", "notifications", "files_upload", "files_explorer",
      "digital_signatures", "sms", "marketing_sms",
      "financial_reports", "receipts", "cheques", "debt_tracking",
    ]),
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
    users_limit: null, branches_limit: 3, policies_limit: null,
    sms_limit: 200, marketing_sms_limit: 300, ai_limit: 250,
    default_features: fillFeatures(ALL_FEATURE_KEYS),
  },
];

const INFO_CENTER_ITEMS = [
  { title: "كل الأدوات", desc: "إدارة الوكالة تحت سقف واحد", icon: Play, href: "/landing#demo" },
  { title: "الحلول", desc: "كل ما تحتاجه لتنمو في مكان واحد", icon: CheckCircle, href: "/landing#solutions" },
  { title: "لماذا ثقة", desc: "ثلاثة محاور تقلب طريقة عمل الوكالة", icon: Sparkles, href: "/landing#features" },
  { title: "آراء العملاء", desc: "ماذا يقول عملاؤنا عن النظام", icon: Star, href: "/landing#testimonials" },
];

const SUPPORT_ITEMS = [
  {
    title: "عرض توضيحي",
    desc: "احجز جلسة تعريفية مع ممثلنا",
    icon: MessageSquare,
    href: "",
    filled: true,
    demo: true,
  },
  {
    title: "أسئلة وأجوبة",
    desc: "إجابات على الاستفسارات الشائعة",
    icon: HelpCircle,
    href: "/faq",
    filled: false,
  },
  {
    title: "تواصل معنا",
    desc: "هل لديك أسئلة؟ تحدّث معنا",
    icon: MessageSquare,
    href: "/contact",
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
  // Shared expand state — clicking "عرض جميع الميزات" on any card
  // expands every card to reveal the full feature catalog as a
  // ✓/✗ matrix in-place, exactly like the agent-side PlanLadder.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Plans live in React Query so the prerender pass dehydrates them
  // alongside useLandingContent, and a real visit's hydration first
  // render uses the same data the captured DOM was produced from.
  // FALLBACK_PLANS keeps things sensible when the query is still
  // loading or Supabase is unreachable from the build environment.
  const { data: plansData } = useQuery({
    queryKey: ["pricing-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("id, plan_key, name, name_ar, description, monthly_price, yearly_price, badge, users_limit, branches_limit, policies_limit, sms_limit, marketing_sms_limit, ai_limit, default_features")
        .eq("is_active", true)
        .order("sort_order");
      if (error || !data || data.length === 0) return FALLBACK_PLANS;
      return data.map((p: any) => ({
        ...p,
        default_features:
          (typeof p.default_features === "string"
            ? JSON.parse(p.default_features)
            : p.default_features) || {},
      })) as PlanData[];
    },
    staleTime: 5 * 60 * 1000,
  });
  const plans = plansData ?? FALLBACK_PLANS;
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

  // `show_public_prices` toggle (Thiqa admin → الخطط والأسعار). When the
  // platform setting is 'false', the price block + yearly toggle are
  // concealed but the upgrade CTA stays clickable. React Query so the
  // prerender pass dehydrates this and hydration's first render produces
  // the same value the captured DOM was prerendered with.
  const { data: showPrices = true } = useQuery({
    queryKey: ["pricing-show-public-prices"],
    queryFn: async () => {
      const { data } = await supabase
        .from("thiqa_platform_settings")
        .select("setting_value")
        .eq("setting_key", "show_public_prices")
        .maybeSingle();
      return data?.setting_value !== "false";
    },
    staleTime: 5 * 60 * 1000,
  });

  // Paid plans only (free_trial is shown elsewhere). With lg:grid-cols-3
  // a 5-plan layout becomes 3 + 2; the trailing empty cell(s) of the
  // last lg-row are filled by hidden-on-mobile placeholders below so
  // the row separator hairline completes across the full width.
  const paidPlans = plans.filter((p) => p.plan_key !== 'free_trial');
  const lgPlaceholderCount = (3 - (paidPlans.length % 3)) % 3;

  return (
    <div
      className="min-h-screen text-black overflow-x-hidden relative bg-white public-page-enter"
      dir="rtl"
      style={{ fontFamily: "'Cairo', sans-serif" }}
    >
      <PublicSEO
        title="أسعار وخطط Thiqa — نظام إدارة وكالات التأمين"
        description="خطط وأسعار Thiqa الشفافة لوكالات التأمين. اختر الخطة المناسبة لحجم وكالتك وابدأ بفترة تجريبية مجانية 35 يوماً، بدون التزام."
        keywords="أسعار Thiqa, خطط اشتراك Thiqa, تكلفة نظام إدارة التأمين, اشتراك مجاني, خطة احترافية, ثقة"
      />
      <BreadcrumbJsonLd
        crumbs={[
          { label: "Thiqa", href: "/" },
          { label: "الأسعار", href: "/pricing" },
        ]}
      />
      {showPrices && (
        <PricingJsonLd
          offers={plans.map((p) => ({
            name: p.name_ar || p.name,
            description: p.description,
            monthlyPrice: p.monthly_price,
            yearlyPrice: p.yearly_price,
          }))}
        />
      )}
      <PublicGradientBackground />

      {/* ═══ Navbar — static light pill, same 3-item structure as the
          landing page. Mobile collapses to login + hamburger + drawer. */}
      <nav className="fixed inset-x-0 top-0 z-50 pointer-events-none mt-3">
        <div
          className="pointer-events-auto flex flex-row-reverse lg:flex-row items-center justify-between lg:justify-normal px-4 lg:px-6 h-14 lg:h-16 mx-auto w-[92%] lg:w-[75%] max-w-[72rem] rounded-full bg-white/75 backdrop-blur-md shadow-[0_1px_20px_0_rgba(0,0,0,0.10)]"
        >
          {/* Logo */}
          <div className="lg:flex-1 lg:flex lg:justify-start">
            <a href="/landing" className="flex items-center text-black">
              <ThiqaLogoAnimation
                iconSize={32}
                interactive={false}
                iconSrc="https://thiqacrm.b-cdn.net/small_black.png"
              />
            </a>
          </div>

          {/* Desktop menu */}
          <div className="hidden lg:flex items-center gap-10 text-[14px] font-medium text-black/75">
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
                    const inner = (
                      <>
                        <div className={cn(
                          "flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg pointer-events-none",
                          item.filled ? "bg-black text-white" : "bg-black/[0.05] text-black",
                        )}>
                          <Icon className="w-4 h-4" strokeWidth={2.2} />
                        </div>
                        <div className="flex-1 min-w-0 pointer-events-none">
                          <div className="text-[15px] font-bold text-black leading-tight">{item.title}</div>
                          <div className="text-[13px] text-black/55 mt-0.5 leading-snug">{item.desc}</div>
                        </div>
                      </>
                    );
                    const cls = "w-full flex items-center gap-4 rounded-xl px-3 py-3 hover:bg-black/[0.03] transition-colors text-right";
                    if ("demo" in item && item.demo) {
                      return (
                        <DemoCallTrigger key={item.title} className={cls}>
                          {inner}
                        </DemoCallTrigger>
                      );
                    }
                    return (
                      <a key={item.title} href={item.href} className={cls}>
                        {inner}
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* CTA cluster */}
          <div className="lg:flex-1 flex flex-row-reverse lg:flex-row lg:justify-end items-center gap-3 lg:gap-5">
            <button
              onClick={() => navigate("/login")}
              className="text-[14px] font-semibold text-black/80 hover:text-black transition-colors inline-flex items-center"
            >
              {ct(content, "navbar_login", "تسجيل الدخول")}
            </button>

            <button
              onClick={() => { trackEvent("signup_click", "/pricing"); navigate("/register"); }}
              className="hidden lg:inline-flex px-8 py-3 text-[14px] font-bold text-black hover:bg-black/5 transition-all rounded-full"
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
              className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-full text-black hover:bg-black/5 transition-colors"
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
          "fixed inset-0 z-[60] lg:hidden transition-opacity duration-300",
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
                className="px-5 py-2 text-[14px] font-semibold text-white rounded-full bg-black hover:bg-black/85 transition-colors"
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
                        const inner = (
                          <>
                            <div className={cn(
                              "flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg pointer-events-none",
                              item.filled ? "bg-black text-white" : "bg-black/[0.05] text-black",
                            )}>
                              <Icon className="w-4 h-4" strokeWidth={2.2} />
                            </div>
                            <div className="flex-1 min-w-0 pointer-events-none">
                              <div className="text-[15px] font-bold text-black leading-tight">{item.title}</div>
                              <div className="text-[13px] text-black/55 mt-0.5 leading-snug">{item.desc}</div>
                            </div>
                          </>
                        );
                        const cls = "w-full flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-black/[0.03] transition-colors text-right";
                        return (
                          <li key={item.title}>
                            {"demo" in item && item.demo ? (
                              <DemoCallTrigger className={cls}>
                                {inner}
                              </DemoCallTrigger>
                            ) : (
                              <a
                                href={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={cls}
                              >
                                {inner}
                              </a>
                            )}
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

      {/* ═══ Pricing Hero — sits on the purple band of the gradient,
          so copy is white for contrast. */}
      <section className="relative z-10 pt-32 md:pt-40 pb-12 md:pb-16 text-center px-6">
        <p className="text-sm text-black/65 mb-4 tracking-wide font-medium">
          {ct(content, "pricing_label", "الأسعار")}
        </p>
        <h1 className="text-[2rem] md:text-[3rem] lg:text-[3.4rem] font-bold mb-5 leading-[1.15] text-black">
          {ct(content, "pricing_title", "جرّب نظام الإدارة لمدة 35 يوم مجاناً *")}
        </h1>
        <p className="text-black/70 text-[15px] md:text-base max-w-xl mx-auto leading-relaxed">
          {ct(content, "pricing_subtitle", "* جميع الميزات مفتوحة بالكامل — بدون بطاقة ائتمان.")}
        </p>
      </section>

      {/* ═══ Pricing Cards — Strain-style transparent cards: no
          background, no border, no side rules. Sections are split by
          full-width horizontal hairlines, exactly like the reference.
          The card with a `badge` gets a violet "popular" pill above
          the top hairline. */}
      <section className="relative z-10 pt-12 md:pt-20 pb-8 md:pb-12 px-4 md:px-6" aria-labelledby="pricing-plans-heading">
        <h2 id="pricing-plans-heading" className="sr-only">
          خطط أسعار Thiqa
        </h2>
        {/* One shared frame around the whole grid — the cards are
            connected by hairlines, not individual outlined boxes
            (Strain reference). The 12px dots at every line crossing
            mark each section/column intersection. Three columns on lg
            so a 5-plan catalogue wraps as 3 + 2 (with placeholder cells
            completing the bottom-row hairline). */}
        <div className="max-w-7xl mx-auto border border-black/15 rounded-2xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 bg-white/40 backdrop-blur-[2px]">
          {paidPlans.map((plan, idx, arr) => {
            const isPopular = !!plan.badge;
            const isFree = plan.monthly_price === 0;
            const yearly = isYearly(plan.plan_key);
            const hasYearly = !isFree && plan.yearly_price > 0;
            // `yearly_price` is the annual TOTAL (matches PlanLadder +
            // change-agent-plan), so savings = monthly × 12 − yearly,
            // and on the yearly toggle we render the annual total with
            // a / سنة suffix instead of pretending it's a per-month
            // figure.
            const annualSavings = hasYearly
              ? Math.max(0, plan.monthly_price * 12 - plan.yearly_price)
              : 0;
            const showYearly = yearly && hasYearly;
            const displayPrice = isFree
              ? 0
              : showYearly
                ? plan.yearly_price
                : plan.monthly_price;
            const isFirst = idx === 0;
            // lg-row position: with 3 cols, idx % 3 === 0 is the rightmost
            // card in its row (RTL), so it abuts the outer frame on its
            // right and skips border-r. The leftmost-rendered card in a
            // row is either at col 3 in DOM, or the very last DOM card
            // when the final lg-row is partial (e.g. 5 cards → idx 4
            // sits in the middle DOM-wise but is leftmost-rendered
            // since col 3 is filled by a placeholder).
            const lgRow = Math.floor(idx / 3);
            const isRightmostInLgRow = idx % 3 === 0;
            const isLeftmostRendered = idx % 3 === 2 || idx === arr.length - 1;
            return (
              <div
                key={plan.id}
                className={cn(
                  "relative flex flex-col pricing-card-enter",
                  // Vertical hairline on the card's right side (RTL: this
                  // is the divider with the previous DOM card to its right).
                  !isRightmostInLgRow && "lg:border-r lg:border-black/15",
                  // Horizontal hairlines between stacked cards on
                  // mobile/tablet.
                  !isFirst && "border-t border-black/15",
                  // On lg, only cards in row 2+ get a top border so the
                  // single-row case stays seamless under the outer frame.
                  lgRow > 0 ? "lg:border-t lg:border-black/15" : "lg:border-t-0",
                )}
                style={{ animationDelay: `${200 + idx * 120}ms` }}
              >
                {isPopular && (
                  <div className="absolute -top-3 right-6 inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold rounded-full bg-[#7C5CFF] text-white whitespace-nowrap z-10">
                    <Sparkles className="h-3 w-3" />
                    {plan.badge}
                  </div>
                )}

                {/* ── Header: name, description, price */}
                <div className="px-7 md:px-8 pt-8 pb-6 min-h-[260px]">
                  <h3 className="text-2xl font-bold text-black tracking-tight">
                    {plan.name_ar || plan.name}
                  </h3>
                  <p className="text-[11px] text-black/45 mt-1 uppercase tracking-[0.18em] font-semibold">
                    {plan.name}
                  </p>
                  {plan.description && (
                    <p className="text-[13px] text-black/60 mt-3 leading-relaxed min-h-[2.6em]">
                      {plan.description}
                    </p>
                  )}
                  <div className="mt-6 flex items-baseline gap-1.5">
                    {showPrices ? (
                      <>
                        <span className="text-4xl font-extrabold text-black tracking-tight tabular-nums leading-none">
                          {isFree ? "0" : displayPrice}
                        </span>
                        <span className="text-xl font-bold text-black/80">₪</span>
                        {!isFree && (
                          <span className="text-[13px] text-black/55 font-medium">
                            {showYearly ? "/ سنة" : "/ شهر"}
                          </span>
                        )}
                        {isFree && (
                          <span className="text-[13px] text-black/55 font-medium">للأبد</span>
                        )}
                      </>
                    ) : (
                      <span className="text-2xl font-bold text-black/85 tracking-tight leading-none">
                        السعر عند الطلب
                      </span>
                    )}
                  </div>
                </div>

                {/* ── Hairline + 12px corner dots at each line crossing.
                    The dots use CSS pseudo-elements positioned at the
                    line endpoints, so they sit on top of the vertical
                    column dividers exactly like the Strain reference. */}
                <SectionDivider isFirst={isRightmostInLgRow} isLast={isLeftmostRendered} />

                {/* ── Billing toggle (paid plans) or trial info (free).
                    Toggle group sits on the RIGHT (start in RTL) next
                    to its label; the per-plan annual savings appears
                    on the LEFT only when yearly is selected, so users
                    see the concrete amount they save the moment they
                    flip the switch. */}
                <div className="px-7 md:px-8 py-4 min-h-[64px] flex items-center justify-between">
                  {!showPrices ? (
                    <span className="text-[13px] text-black/65">
                      {isFree ? "خطة مجانية. بلا التزامات." : "تواصل معنا لمعرفة التفاصيل"}
                    </span>
                  ) : hasYearly ? (
                    <>
                      <div className="flex items-center gap-2.5">
                        <span className="text-[13px] font-semibold text-black">
                          {yearly ? "سنوي" : "شهري"}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleYearly(plan.plan_key)}
                          className={cn(
                            "relative w-10 h-[22px] rounded-full transition-colors shrink-0",
                            yearly ? "bg-black" : "bg-black/20",
                          )}
                          aria-pressed={yearly}
                          role="switch"
                          aria-checked={yearly}
                          aria-label="تبديل الفوترة السنوية"
                        >
                          <span
                            className={cn(
                              "absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all",
                              yearly ? "right-[2px]" : "left-[2px]",
                            )}
                          />
                        </button>
                      </div>
                      {yearly && annualSavings > 0 && (
                        <span className="text-[13px] text-emerald-600 font-semibold tabular-nums">
                          موفّر ₪{annualSavings}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[13px] text-black/65">
                      {isFree ? "خطة مجانية. بلا التزامات." : "فوترة شهرية"}
                    </span>
                  )}
                </div>

                <SectionDivider isFirst={isRightmostInLgRow} isLast={isLeftmostRendered} />

                {/* ── CTA — full-width black pill */}
                <div className="px-7 md:px-8 py-5">
                  <button
                    type="button"
                    onClick={() => {
                      trackEvent("signup_click", `/pricing:${plan.plan_key}`);
                      navigate("/register");
                    }}
                    className="w-full py-3.5 rounded-full font-bold text-[14px] bg-black text-white transition-all hover:bg-black/85"
                  >
                    {isFree ? "ابدأ مجاناً" : `انضم لخطة ${plan.name_ar || plan.name}`}
                  </button>
                </div>

                {/* ── Quota rows + in-place "show all features" expand
                    (same data + UX as the agent PlanLadder). All
                    cards share `detailsOpen` so toggling one expands
                    every column for side-by-side comparison. */}
                <div className="px-7 md:px-8 pt-2 pb-7 flex-1">
                  <p className="font-bold text-[13.5px] text-black mb-4">ماذا تشمل هذه الخطة؟</p>
                  <div className="space-y-2.5">
                    <QuotaRow icon={Users} label="مستخدم" value={formatLimit(plan.users_limit)} />
                    <QuotaRow icon={Building2} label="فرع" value={formatLimit(plan.branches_limit)} />
                    <QuotaRow icon={FileText} label="معاملة" value={formatLimit(plan.policies_limit)} />
                    <QuotaRow icon={Mail} label="SMS / شهر" value={plan.sms_limit ? `${plan.sms_limit}` : '—'} />
                    <QuotaRow icon={Megaphone} label="SMS تسويقية / شهر" value={plan.marketing_sms_limit ? `${plan.marketing_sms_limit}` : '—'} />
                    <QuotaRow icon={Bot} label="طلب AI / شهر" value={plan.ai_limit ? `${plan.ai_limit}` : '—'} />
                  </div>

                  {detailsOpen && (
                    <div className="mt-4 pt-4 border-t border-black/10 space-y-4">
                      {PLAN_FEATURE_CATALOG.map((group) => (
                        <div key={group.group}>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-black/55 mb-2">
                            {group.group}
                          </p>
                          <ul className="space-y-1.5">
                            {group.items.map((f) => {
                              const has = plan.default_features?.[f.key] === true;
                              return (
                                <li
                                  key={f.key}
                                  className={cn(
                                    'flex items-center gap-2 text-[13px]',
                                    has ? 'text-black font-medium' : 'text-black/40',
                                  )}
                                >
                                  {has ? (
                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-white shrink-0">
                                      <Check className="h-3 w-3" strokeWidth={3} />
                                    </span>
                                  ) : (
                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-black/[0.06] text-black/40 shrink-0">
                                      <X className="h-3 w-3" strokeWidth={3} />
                                    </span>
                                  )}
                                  <span className="truncate">{f.label}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setDetailsOpen((v) => !v)}
                    className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-bold text-black hover:text-[#7C5CFF] transition-colors"
                  >
                    {detailsOpen ? "إخفاء التفاصيل" : "عرض جميع الميزات"}
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 transition-transform", detailsOpen && "rotate-180")}
                      strokeWidth={2.5}
                    />
                  </button>
                </div>
              </div>
            );
          })}
          {/* Empty grid cells that fill out the last lg-row when the
              plan count isn't a multiple of 3 (e.g. 5 plans → one
              placeholder so the row-2 separator hairline spans the
              full width). Mobile/tablet ignore them via `hidden`.
              The first placeholder also draws a `border-r` so the
              last DOM card gets a closing vertical hairline on its
              left side (otherwise the card looks open-ended against
              empty space). */}
          {Array.from({ length: lgPlaceholderCount }, (_, i) => (
            <div
              key={`pricing-placeholder-${i}`}
              aria-hidden
              className={cn(
                "hidden lg:block lg:border-t lg:border-black/15",
                i === 0 && "lg:border-r",
              )}
            />
          ))}
        </div>
      </section>

      {/* ═══ FAQ ═══ Same component the landing page uses, so editing
          questions/answers in FAQSection.tsx updates both surfaces.
          `compact` trims the section padding so the FAQ sits tighter
          under the pricing grid (the landing page keeps the roomier
          default since it has its own visual rhythm). */}
      <FAQSection compact />

      <PublicFooter />
    </div>
  );
}

// One quota line inside a pricing card (مستخدم / فرع / معاملة / SMS / …).
// Same shape and visual weight as the agent-side PlanLadder QuotaRow
// so users moving between the public pricing page and the in-app
// plan ladder see the same structure.
function QuotaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  const isEmpty = value === '—';
  return (
    <div className={cn("flex items-center justify-between gap-2", isEmpty && "opacity-50")}>
      <div className="flex items-center gap-2 text-black/65 min-w-0">
        <Icon className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.7} />
        <span className="truncate text-[13px]">{label}</span>
      </div>
      <span className="font-semibold tabular-nums text-black text-[13px]">{value}</span>
    </div>
  );
}

// 1px hairline that runs across an entire pricing-card cell, with
// 12px gray dots at each end so the line "snaps" onto the vertical
// column dividers exactly like the Strain reference. The first/last
// flags suppress the dot that would land on the outer rounded frame
// (where there's no vertical divider to land on, so a dot would just
// look like a stray bump on the rounded corner).
function SectionDivider({ isFirst, isLast }: { isFirst: boolean; isLast: boolean }) {
  return (
    <div className="relative border-t border-black/15">
      {/* Right-edge dot. In RTL, this is the rightmost end of the line.
          Hidden on the rightmost (first DOM) card so it doesn't sit
          on the outer frame. */}
      {!isFirst && (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full bg-black/15 z-[1]"
        />
      )}
      {/* Left-edge dot. Hidden on the leftmost (last DOM) card. */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute -top-1.5 -left-1.5 h-3 w-3 rounded-full bg-black/15 z-[1]"
        />
      )}
    </div>
  );
}
