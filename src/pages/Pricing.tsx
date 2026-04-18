import { useState, useEffect } from "react";
import { usePageView, trackEvent } from "@/hooks/useAnalyticsTracker";
import { useNavigate } from "react-router-dom";
import {
  Check, Info, ChevronDown, Menu, X, Play, Sparkles, Star, HelpCircle, MessageSquare,
} from "lucide-react";
import { useLandingContent, ct } from "@/hooks/useLandingContent";
import { supabase } from "@/integrations/supabase/client";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
import thiqaLogo from "@/assets/thiqa-logo-full.svg";
import { cn } from "@/lib/utils";

interface PlanData {
  id: string;
  plan_key: string;
  name: string;
  description: string | null;
  monthly_price: number;
  yearly_price: number;
  badge: string | null;
  features: { text: string; info: boolean }[];
}

// Fallback plans if DB fetch fails
const FALLBACK_PLANS: PlanData[] = [
  {
    id: "starter",
    plan_key: "starter",
    name: "Starter",
    description: "مناسب للوكلاء المستقلين في بداية الطريق",
    monthly_price: 240,
    yearly_price: 200,
    badge: null,
    features: [
      { text: "إدارة حتى 200 عميل", info: true },
      { text: "إصدار وثائق أساسي", info: true },
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
    description: "مناسب لوكالات التأمين الصغيرة والمتوسطة",
    monthly_price: 240,
    yearly_price: 200,
    badge: "الأكثر شعبية",
    features: [
      { text: "إدارة عملاء بلا حدود", info: true },
      { text: "إصدار وثائق متقدم", info: true },
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
  const [yearly, setYearly] = useState(false);
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
          .select("id, plan_key, name, description, monthly_price, yearly_price, badge, features")
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
      {/* Top blue gradient — covers hero area, fades into white by the
          time the pricing cards start. Absolute so it layers under the
          content without pushing anything around. */}
      <div
        className="absolute inset-x-0 top-0 h-[640px] md:h-[720px] pointer-events-none z-0"
        style={{
          background:
            "linear-gradient(180deg, #4b7bff 0%, #6d98ff 22%, #a6c3ff 48%, #dce8ff 70%, rgba(255,255,255,0) 100%)",
        }}
        aria-hidden="true"
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

      {/* ═══ Pricing Hero — sits over the blue gradient, so the copy
          is white for contrast and the small label is a soft white. */}
      <section className="relative z-10 pt-32 md:pt-40 pb-16 md:pb-24 text-center px-6">
        <p className="text-sm text-white/80 mb-4 tracking-wide font-medium">
          {ct(content, "pricing_label", "الأسعار")}
        </p>
        <h1 className="text-[2rem] md:text-[3rem] lg:text-[3.4rem] font-bold mb-5 leading-[1.15] text-white drop-shadow-[0_2px_12px_rgba(15,40,120,0.22)]">
          {ct(content, "pricing_title", "جرّب نظام CRM لمدة 35 يوم مجاناً *")}
        </h1>
        <p className="text-white/85 text-[15px] md:text-base max-w-xl mx-auto leading-relaxed">
          {ct(content, "pricing_subtitle", "* جميع الميزات مفتوحة بالكامل — بدون بطاقة ائتمان.")}
        </p>
      </section>

      {/* ═══ Pricing Cards — white on white body, each card has a soft
          shadow to lift off the page. The card with a `badge` gets a
          violet pill on top plus a slight ring so the "most popular"
          option reads instantly. */}
      <section className="relative z-10 pb-24 px-4 md:px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {plans.map((plan) => {
            const isPopular = !!plan.badge;
            return (
              <div
                key={plan.id}
                className={cn(
                  "relative rounded-2xl bg-white flex flex-col shadow-[0_10px_40px_-12px_rgba(15,40,120,0.12)]",
                  isPopular ? "border-2 border-[#7C5CFF]/40" : "border border-black/[0.06]",
                )}
              >
                {/* Header — plan name (RTL: on the right) + optional
                    "most popular" pill (left). */}
                <div className="p-7 md:p-8 pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-2xl font-bold text-[#7C5CFF]">{plan.name}</h3>
                    {plan.badge && (
                      <span className="px-3.5 py-1.5 text-xs font-bold rounded-full bg-[#7C5CFF]/10 text-[#7C5CFF]">
                        {plan.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-black/55 mb-1 leading-relaxed">{plan.description}</p>
                </div>

                {/* Price */}
                <div className="px-7 md:px-8 py-5 border-t border-dashed border-black/[0.08]">
                  <div className="flex items-baseline gap-2 justify-end">
                    <span className="text-sm text-black/50">₪ شهرياً</span>
                    <span className="text-5xl md:text-6xl font-extrabold text-black tracking-tight">
                      {yearly ? plan.yearly_price : plan.monthly_price}
                    </span>
                  </div>
                </div>

                {/* Yearly toggle */}
                <div className="px-7 md:px-8 py-4 border-t border-dashed border-black/[0.08] flex items-center justify-end gap-3">
                  <span className="text-sm text-black/60">سنوي</span>
                  <button
                    onClick={() => setYearly(!yearly)}
                    className={cn(
                      "relative w-12 h-7 rounded-full transition-colors",
                      yearly ? "bg-[#7C5CFF]" : "bg-black/15",
                    )}
                    aria-pressed={yearly}
                    aria-label="تبديل الفوترة السنوية"
                  >
                    <span
                      className={cn(
                        "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all",
                        yearly ? "right-1" : "left-1",
                      )}
                    />
                  </button>
                </div>

                {/* CTA */}
                <div className="px-7 md:px-8 py-5 border-t border-dashed border-black/[0.08]">
                  <button
                    onClick={() => { trackEvent("signup_click", `/pricing:${plan.plan_key}`); navigate("/register"); }}
                    className={cn(
                      "w-full py-3.5 rounded-full font-bold text-sm transition-colors",
                      isPopular
                        ? "bg-black text-white hover:bg-black/90"
                        : "bg-black/[0.05] text-black hover:bg-black/10 border border-black/10",
                    )}
                  >
                    انضم لخطة {plan.name} مجاناً
                  </button>
                </div>

                {/* Features */}
                <div className="px-7 md:px-8 pt-4 pb-7 md:pb-8 border-t border-dashed border-black/[0.08]">
                  <p className="font-bold text-sm text-black mb-4 text-right">ماذا تشمل هذه الخطة؟</p>
                  <ul className="space-y-3">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-3 text-sm text-black/70">
                        {f.info && <Info className="h-4 w-4 text-black/25 shrink-0" />}
                        {!f.info && <span className="w-4" />}
                        <span className="flex-1 text-right">{f.text}</span>
                        <Check className="h-4 w-4 text-[#7C5CFF] shrink-0" strokeWidth={2.5} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ═══ Footer — light theme. Collapsible sections on mobile
          (native <details>) match the landing-page pattern. */}
      <footer className="relative z-10 border-t border-black/[0.08] pt-16 pb-8 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col divide-y divide-black/[0.06]">
            {[
              { title: "معلومات", items: ["مركز المساعدة", "اتصل بنا"] },
              { title: "شروط وسياسات", items: ["شروط الاستخدام", "سياسة الخصوصية", "إمكانية الوصول"] },
              { title: "الدعم", items: ["دردشة الدعم", "أسئلة شائعة", "support@getthiqa.com"] },
            ].map((section, idx) => (
              <details key={idx} className="group py-6">
                <summary className="flex items-center justify-between cursor-pointer list-none">
                  <span className="text-lg font-bold text-black">{section.title}</span>
                  <span className="text-black/40 text-2xl font-light group-open:hidden">+</span>
                  <span className="text-black/40 text-2xl font-light hidden group-open:inline">−</span>
                </summary>
                <ul className="mt-4 space-y-3 text-sm text-black/55 text-right">
                  {section.items.map((item, j) => (
                    <li key={j}><a href="#" className="hover:text-black/80 transition-colors">{item}</a></li>
                  ))}
                </ul>
              </details>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-8 mb-8">
            <div className="h-1.5 w-1.5 rounded-full bg-black/20" />
            <div className="flex-1 h-px bg-black/[0.08]" />
            <div className="h-1.5 w-1.5 rounded-full bg-black/20" />
          </div>

          <p className="text-sm text-black/40 text-center mb-12">جميع الحقوق محفوظة © Thiqa {new Date().getFullYear()}</p>

          <div className="flex justify-center overflow-hidden">
            <img src={thiqaLogo} alt="Thiqa" className="w-[80%] md:w-[60%] max-w-[700px] opacity-[0.08]" />
          </div>
        </div>
      </footer>
    </div>
  );
}
