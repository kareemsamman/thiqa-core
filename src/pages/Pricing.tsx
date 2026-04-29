import { Fragment, useState, useEffect } from "react";
import { usePageView, trackEvent } from "@/hooks/useAnalyticsTracker";
import { useNavigate } from "react-router-dom";
import {
  Check, ChevronDown, Menu, X, Play, Sparkles, Star, HelpCircle, MessageSquare,
  LayoutDashboard, ListChecks, Users, AlertTriangle, Mail, RefreshCw, Bell,
  Upload, FolderOpen, PenLine, MessageCircle, Megaphone, Bot, TrendingUp,
  Wallet, Building2, Calculator, Receipt, Banknote, Coins, Wrench,
  type LucideIcon,
} from "lucide-react";
import { useLandingContent, ct } from "@/hooks/useLandingContent";
import { supabase } from "@/integrations/supabase/client";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
import { cn } from "@/lib/utils";
import { PublicSEO } from "@/components/public/PublicSEO";
import { PLAN_FEATURE_CATALOG } from "@/lib/planFeatureCatalog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PlanData {
  id: string;
  plan_key: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  monthly_price: number;
  yearly_price: number;
  badge: string | null;
  default_features: Record<string, boolean>;
}

// Maps feature catalog keys → Lucide icon used in the card list. Keep
// in sync with PLAN_FEATURE_CATALOG; an unmapped key falls back to a
// neutral check.
const FEATURE_ICON: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  tasks: ListChecks,
  contacts: Users,
  accident_reports: AlertTriangle,
  correspondence: Mail,
  renewals: RefreshCw,
  notifications: Bell,
  files_upload: Upload,
  files_explorer: FolderOpen,
  digital_signatures: PenLine,
  sms: MessageCircle,
  marketing_sms: Megaphone,
  ai_assistant: Bot,
  financial_reports: TrendingUp,
  broker_wallet: Wallet,
  company_settlement: Building2,
  accounting: Calculator,
  receipts: Receipt,
  cheques: Banknote,
  debt_tracking: Coins,
  repair_claims: Wrench,
};

// Number of features visible inside each card before the "compare all"
// button takes over. Mirrors the Strain layout where the first 8-ish
// items hint at value, deeper detail lives in the comparison view.
const VISIBLE_FEATURE_COUNT = 8;

// Default-features map used by the fallback plans. Keys come from
// PLAN_FEATURE_CATALOG; the higher the plan the more flags flip on.
const ALL_FEATURE_KEYS = PLAN_FEATURE_CATALOG.flatMap((g) => g.items.map((i) => i.key));
const fillFeatures = (keys: string[]): Record<string, boolean> => {
  const map: Record<string, boolean> = {};
  for (const k of ALL_FEATURE_KEYS) map[k] = keys.includes(k);
  return map;
};

// Fallback plans if DB fetch fails. default_features mirrors the
// shape returned by `subscription_plans.default_features` so the
// rendering path is identical whether data is live or fallback.
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
  // Cross-plan "compare all features" dialog. Opened from any card's
  // "عرض جميع الميزات" link — shows the full PLAN_FEATURE_CATALOG as
  // a side-by-side matrix instead of expanding cards individually.
  const [compareOpen, setCompareOpen] = useState(false);
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
          .select("id, plan_key, name, name_ar, description, monthly_price, yearly_price, badge, default_features")
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
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-7">
          {plans.filter((p) => p.plan_key !== 'free_trial').map((plan) => {
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
            // Filter the shared feature catalog to just the entries
            // this plan ships with — same source as the agent-side
            // PlanLadder / Subscription page.
            const includedFeatures = PLAN_FEATURE_CATALOG.flatMap((g) => g.items)
              .filter((item) => plan.default_features?.[item.key] === true);
            const visibleFeatures = includedFeatures.slice(0, VISIBLE_FEATURE_COUNT);
            const hiddenCount = Math.max(0, includedFeatures.length - VISIBLE_FEATURE_COUNT);
            return (
              <div
                key={plan.id}
                className="relative flex flex-col rounded-2xl border border-black/15 bg-white/40 backdrop-blur-[2px] px-7 md:px-8"
              >
                {isPopular && (
                  <div className="absolute -top-3 right-6 inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold rounded-full bg-[#7C5CFF] text-white whitespace-nowrap">
                    <Sparkles className="h-3 w-3" />
                    {plan.badge}
                  </div>
                )}

                {/* ── Header: name, description, price */}
                <div className="pt-8 pb-6">
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

                {/* ── Hairline (full-width, runs edge-to-edge) */}
                <div className="border-t border-black/15 -mx-7 md:-mx-8" />

                {/* ── Billing toggle (paid plans) or trial info (free) */}
                <div className="py-4 min-h-[56px] flex items-center justify-between">
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

                {/* ── Hairline (full-width, runs edge-to-edge) */}
                <div className="border-t border-black/15 -mx-7 md:-mx-8" />

                {/* ── CTA — full-width black pill */}
                <div className="py-5">
                  <button
                    type="button"
                    onClick={() => {
                      trackEvent("signup_click", `/pricing:${plan.plan_key}`);
                      navigate("/register");
                    }}
                    className="w-full py-3.5 rounded-full font-bold text-[14px] bg-black text-white transition-all hover:bg-black/85"
                  >
                    {isFree ? "ابدأ مجاناً" : `انضم لخطة ${plan.name}`}
                  </button>
                </div>

                {/* ── Feature list (catalog-driven, with icons) */}
                <div className="pt-2 pb-7 flex-1">
                  <p className="font-bold text-[13.5px] text-black mb-4">ماذا تشمل هذه الخطة؟</p>
                  <ul className="space-y-3.5">
                    {visibleFeatures.map((f) => {
                      const Icon = FEATURE_ICON[f.key] ?? Check;
                      return (
                        <li key={f.key} className="flex items-center gap-3 text-[13px] text-black/80">
                          <Icon className="h-[18px] w-[18px] shrink-0 text-black/70" strokeWidth={1.7} />
                          <span className="flex-1 leading-tight">{f.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setCompareOpen(true)}
                      className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-bold text-black hover:text-[#7C5CFF] transition-colors"
                    >
                      عرض جميع الميزات
                      <ChevronDown className="h-3.5 w-3.5 -rotate-90" strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Page-level "compare all" link below the grid — gives users
            a way to open the matrix even when no card overflows. */}
        <div className="max-w-7xl mx-auto mt-12 flex justify-center">
          <button
            type="button"
            onClick={() => setCompareOpen(true)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-black/15 text-[13.5px] font-bold text-black hover:bg-black/[0.04] transition-colors"
          >
            مقارنة جميع الميزات بين الخطط
            <ChevronDown className="h-4 w-4 -rotate-90" strokeWidth={2.5} />
          </button>
        </div>
      </section>

      {/* ═══ Compare-all dialog — full feature catalog × all plans
          rendered as a matrix. Pulls from the same data the cards
          do, so columns/rows stay in lock-step with subscription_plans. */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent
          dir="rtl"
          className="max-w-5xl w-[95vw] max-h-[90vh] overflow-hidden p-0 flex flex-col"
        >
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-black/[0.08]">
            <DialogTitle className="text-right text-xl font-bold">
              مقارنة الميزات بين الخطط
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-auto px-6 pb-6">
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="border-b border-black/15">
                  <th className="py-3 pr-2 text-right font-bold text-black/55 text-[11px] uppercase tracking-wider w-[34%]">
                    الميزة
                  </th>
                  {plans.map((p) => (
                    <th key={p.id} className="py-3 px-2 text-center font-bold text-black">
                      <div className="text-[14px]">{p.name_ar || p.name}</div>
                      <div className="text-[11px] text-black/55 font-medium mt-0.5">
                        {p.monthly_price === 0 ? "مجاناً" : `₪${p.monthly_price}/شهر`}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PLAN_FEATURE_CATALOG.map((group) => (
                  <Fragment key={group.group}>
                    <tr>
                      <td
                        colSpan={1 + plans.length}
                        className="pt-5 pb-2 pr-2 text-right text-[11px] font-bold uppercase tracking-wider text-[#7C5CFF]"
                      >
                        {group.group}
                      </td>
                    </tr>
                    {group.items.map((item) => {
                      const Icon = FEATURE_ICON[item.key] ?? Check;
                      return (
                        <tr key={item.key} className="border-t border-black/[0.06]">
                          <td className="py-2.5 pr-2 text-right text-black/80">
                            <span className="inline-flex items-center gap-2.5">
                              <Icon className="h-4 w-4 shrink-0 text-black/55" strokeWidth={1.7} />
                              {item.label}
                            </span>
                          </td>
                          {plans.map((p) => {
                            const has = p.default_features?.[item.key] === true;
                            return (
                              <td key={p.id} className="py-2.5 px-2 text-center">
                                {has ? (
                                  <Check className="h-4 w-4 mx-auto text-[#7C5CFF]" strokeWidth={3} />
                                ) : (
                                  <X className="h-4 w-4 mx-auto text-black/20" strokeWidth={2} />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

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
