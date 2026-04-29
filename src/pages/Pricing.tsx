import { useState, useEffect } from "react";
import { usePageView, trackEvent } from "@/hooks/useAnalyticsTracker";
import { useNavigate } from "react-router-dom";
import {
  Check, ChevronDown, Menu, X, Play, Sparkles, Star, HelpCircle, MessageSquare,
  Users, FileText, Mail, Megaphone, Bot, Building2,
  type LucideIcon,
} from "lucide-react";
import { useLandingContent, ct } from "@/hooks/useLandingContent";
import { supabase } from "@/integrations/supabase/client";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
import { cn } from "@/lib/utils";
import { PublicSEO } from "@/components/public/PublicSEO";
import { PLAN_FEATURE_CATALOG } from "@/lib/planFeatureCatalog";

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
  // Shared expand state — clicking "عرض جميع الميزات" on any card
  // expands every card to reveal the full feature catalog as a
  // ✓/✗ matrix in-place, exactly like the agent-side PlanLadder.
  const [detailsOpen, setDetailsOpen] = useState(false);
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
          .select("id, plan_key, name, name_ar, description, monthly_price, yearly_price, badge, users_limit, branches_limit, policies_limit, sms_limit, marketing_sms_limit, ai_limit, default_features")
          .eq("is_active", true)
          .order("sort_order");
        if (!error && data && data.length > 0) {
          setPlans(data.map((p: any) => ({
            ...p,
            default_features:
              (typeof p.default_features === 'string'
                ? JSON.parse(p.default_features)
                : p.default_features) || {},
          })));
        }
      } catch {
        // fallback plans already set
      }
    })();
  }, []);

  return (
    <div
      className="min-h-screen text-black overflow-x-hidden relative bg-white"
      dir="rtl"
      style={{ fontFamily: "'Cairo', sans-serif" }}
    >
      <PublicSEO
        title="Thiqa | الأسعار والخطط"
        description="خطط أسعار Thiqa لإدارة وكالات التأمين: ابدأ بالخطة المجانية ووسّع حسب حاجة وكالتك. أسعار شفافة، اشتراكات شهرية وسنوية، وبدون التزامات طويلة."
        keywords="أسعار Thiqa, خطط اشتراك Thiqa, تكلفة نظام إدارة التأمين, اشتراك مجاني, خطة احترافية"
      />
      {/* Purple gradient band — pinned to the top of the page so it
          covers the navbar + hero only and fades into white well
          above the pricing grid (Strain reference). Kept short so
          the cards sit cleanly on white, not on tinted purple. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 inset-x-0 h-[640px]"
        style={{
          background:
            "linear-gradient(180deg, #6F4FFF 0%, #9D89FF 32%, rgba(255,255,255,0.85) 70%, rgba(255,255,255,0) 100%)",
        }}
      />

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

      {/* ═══ Pricing Hero — sits on the purple band of the gradient,
          so copy is white for contrast. */}
      <section className="relative z-10 pt-32 md:pt-40 pb-12 md:pb-16 text-center px-6">
        <p className="text-sm text-white/75 mb-4 tracking-wide font-medium">
          {ct(content, "pricing_label", "الأسعار")}
        </p>
        <h1 className="text-[2rem] md:text-[3rem] lg:text-[3.4rem] font-bold mb-5 leading-[1.15] text-white">
          {ct(content, "pricing_title", "جرّب نظام إدارة وكالات التأمين لمدة 35 يوم مجاناً *")}
        </h1>
        <p className="text-white/80 text-[15px] md:text-base max-w-xl mx-auto leading-relaxed">
          {ct(content, "pricing_subtitle", "* جميع الميزات مفتوحة بالكامل — بدون بطاقة ائتمان.")}
        </p>
      </section>

      {/* ═══ Pricing Cards — Strain-style transparent cards: no
          background, no border, no side rules. Sections are split by
          full-width horizontal hairlines, exactly like the reference.
          The card with a `badge` gets a violet "popular" pill above
          the top hairline. */}
      <section className="relative z-10 pt-12 md:pt-20 pb-24 px-4 md:px-6" aria-labelledby="pricing-plans-heading">
        <h2 id="pricing-plans-heading" className="sr-only">
          خطط أسعار Thiqa
        </h2>
        {/* One shared frame around the whole grid — the cards are
            connected by hairlines, not individual outlined boxes
            (Strain reference). The 12px dots at every line crossing
            mark each section/column intersection. Four columns on lg
            so every paid plan lives on one row regardless of count. */}
        <div className="max-w-7xl mx-auto border border-black/15 rounded-2xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-white/40 backdrop-blur-[2px]">
          {plans.filter((p) => p.plan_key !== 'free_trial').map((plan, idx, arr) => {
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
            const isFirst = idx === 0;
            const isLast = idx === arr.length - 1;
            return (
              <div
                key={plan.id}
                className={cn(
                  "relative flex flex-col",
                  // Vertical hairlines BETWEEN cards on lg (RTL: card 1
                  // is rightmost, so border-r on cards 2+ creates the
                  // shared dividers without doubling the outer frame).
                  !isFirst && "lg:border-r lg:border-black/15",
                  // Horizontal hairlines between stacked cards on
                  // mobile/tablet — disabled on lg where cards sit
                  // side-by-side.
                  !isFirst && "border-t lg:border-t-0 border-black/15",
                )}
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
                    <span className="text-4xl font-extrabold text-black tracking-tight tabular-nums leading-none">
                      {isFree ? "0" : displayPrice}
                    </span>
                    <span className="text-xl font-bold text-black/80">₪</span>
                    {!isFree && (
                      <span className="text-[13px] text-black/55 font-medium">/ شهر</span>
                    )}
                    {isFree && (
                      <span className="text-[13px] text-black/55 font-medium">للأبد</span>
                    )}
                  </div>
                </div>

                {/* ── Hairline + 12px corner dots at each line crossing.
                    The dots use CSS pseudo-elements positioned at the
                    line endpoints, so they sit on top of the vertical
                    column dividers exactly like the Strain reference. */}
                <SectionDivider isFirst={isFirst} isLast={isLast} />

                {/* ── Billing toggle (paid plans) or trial info (free) */}
                <div className="px-7 md:px-8 py-4 min-h-[64px] flex items-center justify-between">
                  {hasYearly ? (
                    <>
                      <span className="text-[12px] text-black/55">
                        {yearly
                          ? `وفّر ₪${annualSavings} سنوياً`
                          : "فوترة شهرية"}
                      </span>
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
                    </>
                  ) : (
                    <span className="text-[13px] text-black/65">
                      {isFree ? "خطة مجانية. بلا التزامات." : "فوترة شهرية"}
                    </span>
                  )}
                </div>

                <SectionDivider isFirst={isFirst} isLast={isLast} />

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
