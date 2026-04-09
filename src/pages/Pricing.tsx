import { useState, useEffect } from "react";
import { usePageView } from "@/hooks/useAnalyticsTracker";
import { useNavigate } from "react-router-dom";
import { Check, Info } from "lucide-react";
import { useLandingContent, ct } from "@/hooks/useLandingContent";
import { supabase } from "@/integrations/supabase/client";
import thiqaLogo from "@/assets/thiqa-logo-full.svg";
import sectionDividerDark from "@/assets/landing/section-divider-dark.png";

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

export default function Pricing() {
  usePageView("/pricing");
  const { data: content } = useLandingContent();
  const navigate = useNavigate();
  const [yearly, setYearly] = useState(false);
  const [plans, setPlans] = useState<PlanData[]>(FALLBACK_PLANS);

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
    <div className="min-h-screen text-white overflow-x-hidden bg-[#171719]" dir="rtl" style={{ fontFamily: "'Cairo', sans-serif" }}>
      {/* ═══ Navbar ═══ */}
      <nav className="absolute top-0 inset-x-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 h-16">
          <a href="/landing" className="flex items-center gap-2.5">
            <img src={thiqaLogo} alt="Thiqa" />
          </a>
          <div className="hidden md:flex items-center gap-10 text-[14px] text-white/70 font-medium">
            <a href="/landing#features" className="hover:text-white transition-colors">لماذا نحن مختلفون</a>
            <a href="/landing#demo" className="hover:text-white transition-colors">كيف يعمل</a>
            <a href="/landing#faq" className="hover:text-white transition-colors">أسئلة وأجوبة</a>
            <a href="/pricing" className="text-white">الأسعار</a>
          </div>
          <button
            onClick={() => navigate("/login?view=signup")}
            className="px-6 py-2 text-[13px] font-bold text-white/90 hover:text-white transition-colors"
            style={{
              borderRadius: '100px',
              border: '2px solid rgba(255, 255, 255, 0.40)',
              background: 'rgba(255, 255, 255, 0.10)',
            }}
          >
            {ct(content, "navbar_cta", "احصل على 35 يوم مجاناً")}
          </button>
        </div>
      </nav>

      {/* ═══ Pricing Hero ═══ */}
      <section className="pt-32 pb-20 text-center px-6">
        <p className="text-sm text-[#7ba4f7] mb-4 tracking-wide">{ct(content, "pricing_label", "الأسعار")}</p>
        <h1 className="text-4xl md:text-[3.2rem] font-bold mb-4 leading-tight">
          {ct(content, "pricing_title", "جرّب نظام CRM لمدة 35 يوم مجاناً *")}
        </h1>
        <p className="text-white/40 text-base max-w-xl mx-auto">
          {ct(content, "pricing_subtitle", "* جميع الميزات مفتوحة بالكامل — بدون بطاقة ائتمان.")}
        </p>
      </section>

      {/* ═══ Pricing Cards ═══ */}
      <section className="pb-24 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] flex flex-col"
            >
              {/* Header */}
              <div className="p-8 pb-0">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-2xl font-bold text-[#a78bfa]">{plan.name}</h3>
                  {plan.badge && (
                    <span className="px-4 py-1.5 text-xs font-bold rounded-lg bg-white/10 text-white/80">
                      {plan.badge}
                    </span>
                  )}
                </div>
                <p className="text-sm text-white/40 mb-6">{plan.description}</p>
              </div>

              {/* Price */}
              <div className="px-8 py-6 border-t border-dashed border-white/[0.06]">
                <div className="flex items-baseline gap-2 justify-end">
                  <span className="text-sm text-white/40">₪ شهرياً</span>
                  <span className="text-6xl font-extrabold text-white/90 tracking-tight">
                    {yearly ? plan.yearly_price : plan.monthly_price}
                  </span>
                </div>
              </div>

              {/* Yearly toggle */}
              <div className="px-8 py-4 border-t border-dashed border-white/[0.06] flex items-center justify-end gap-3">
                <span className="text-sm text-white/50">سنوي</span>
                <button
                  onClick={() => setYearly(!yearly)}
                  className={`relative w-12 h-7 rounded-full transition-colors ${yearly ? "bg-[#a78bfa]" : "bg-white/10"}`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${yearly ? "right-1" : "left-1"}`}
                  />
                </button>
              </div>

              {/* CTA */}
              <div className="px-8 py-6 border-t border-dashed border-white/[0.06]">
                <button
                  onClick={() => navigate("/login?view=signup")}
                  className="w-full py-3.5 rounded-full bg-white text-[#171719] font-bold text-sm hover:bg-white/90 transition-colors"
                >
                  انضم لخطة {plan.name} مجاناً
                </button>
              </div>

              {/* Features */}
              <div className="px-8 pt-2 pb-8 border-t border-dashed border-white/[0.06]">
                <p className="font-bold text-sm text-white/80 mb-4 text-right">ماذا تشمل هذه الخطة؟</p>
                <ul className="space-y-3">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm text-white/50">
                      {f.info && <Info className="h-4 w-4 text-white/20 shrink-0" />}
                      {!f.info && <span className="w-4" />}
                      <span className="flex-1 text-right">{f.text}</span>
                      <Check className="h-4 w-4 text-white/40 shrink-0" />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      <img src={sectionDividerDark} alt="" className="w-full h-auto block" />

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-white/[0.04] pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col divide-y divide-white/[0.06]">
            {[
              { title: "معلومات", items: ["مركز المساعدة", "اتصل بنا"] },
              { title: "شروط وسياسات", items: ["شروط الاستخدام", "سياسة الخصوصية", "إمكانية الوصول"] },
              { title: "الدعم", items: ["دردشة الدعم", "أسئلة شائعة", "info@thiqa.co.il"] },
            ].map((section, idx) => (
              <details key={idx} className="group py-6">
                <summary className="flex items-center justify-between cursor-pointer list-none">
                  <span className="text-lg font-bold text-white/90">{section.title}</span>
                  <span className="text-white/40 text-2xl font-light group-open:hidden">+</span>
                  <span className="text-white/40 text-2xl font-light hidden group-open:inline">−</span>
                </summary>
                <ul className="mt-4 space-y-3 text-sm text-white/40 text-right">
                  {section.items.map((item, j) => (
                    <li key={j}><a href="#" className="hover:text-white/60 transition-colors">{item}</a></li>
                  ))}
                </ul>
              </details>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-8 mb-8">
            <div className="h-1.5 w-1.5 rounded-full bg-white/20" />
            <div className="flex-1 h-px bg-white/[0.06]" />
            <div className="h-1.5 w-1.5 rounded-full bg-white/20" />
          </div>

          <p className="text-sm text-white/20 text-center mb-12">جميع الحقوق محفوظة © Thiqa {new Date().getFullYear()}</p>

          <div className="flex justify-center overflow-hidden">
            <img src={thiqaLogo} alt="Thiqa" className="w-[80%] md:w-[60%] max-w-[700px] opacity-[0.08]" />
          </div>
        </div>
      </footer>
    </div>
  );
}
