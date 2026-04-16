import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePageView, trackEvent } from "@/hooks/useAnalyticsTracker";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, CheckCircle, Star, ArrowLeft, Play, X, Check,
  Users, FileText, CreditCard, BarChart3, Bell, MessageSquare,
  Phone, Shield, RefreshCcw, Wallet,
} from "lucide-react";
import { useLandingContent, ct, ci } from "@/hooks/useLandingContent";
import { cn } from "@/lib/utils";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
import thiqaLogo from "@/assets/thiqa-logo-full.svg";
import dashboardMockupDefault from "@/assets/landing/dashboard-mockup.png";
import featuresMockupDefault from "@/assets/landing/features-mockup.png";
import sectionDivider from "@/assets/landing/section-divider.png";
import sectionDividerDark from "@/assets/landing/section-divider-dark.png";
import featureProfitEngineDefault from "@/assets/landing/feature-profit-engine.png";
import featurePaperlessDefault from "@/assets/landing/feature-paperless.png";
import featureMarketingDefault from "@/assets/landing/feature-marketing.png";
import sliderBgDefault from "@/assets/landing/slider-bg.png";
import gridLogoBgDefault from "@/assets/landing/grid-logo-bg.png";
// Hero video plays back faster than real-time so the motion has more
// "wow" energy without the viewer feeling like they're watching a slow
// product tour. Same pattern the login background uses. Some browsers
// reset playbackRate on the first `play` event (Safari) — we also
// re-apply it in onPlay / onLoadedMetadata handlers.
const SECTION_DIVIDER_URL = "https://thiqacrm.b-cdn.net/linewhite.png";

const HERO_VIDEO_SPEED = 1.5;
const reapplyHeroVideoSpeed = (e: React.SyntheticEvent<HTMLVideoElement>) => {
  (e.currentTarget as HTMLVideoElement).playbackRate = HERO_VIDEO_SPEED;
};

// Section-2 feature tiles. Each tile is also the source of truth
// for its modal: `intro` + `bullets` describe real Thiqa features
// (pulled from the actual pages under src/pages/) and the `gradient`
// / `accent` colors drive the modal hero visual. Change the copy
// here and the popup updates automatically.
const featureTiles = [
  {
    icon: Users,
    title: "إدارة العملاء والسيارات",
    desc: "ملفات عملاء كاملة، سائقون إضافيون، مركبات وتاريخ الوثائق.",
    tint: "bg-indigo-50 text-indigo-600",
    hoverTint: "group-hover:bg-indigo-100",
    gradient: "linear-gradient(135deg, #eef2ff 0%, #c7d2fe 100%)",
    accent: "#4f46e5",
    intro: "ملف عميل موحّد يجمع كل شيء: الهوية، المركبات، السائقين الإضافيين، تاريخ الوثائق والمطالبات — بدون التنقّل بين ملفات Excel.",
    bullets: [
      "ملف عميل مفصّل: الهوية، رقم الملف والملاحظات الطبية",
      "إدارة السائقين الإضافيين وسائقي الأعمار تحت 24",
      "سجل كامل للمركبات والوثائق والتجديدات",
      "تسجيل الحوادث والمطالبات المرتبطة بكل عميل",
      "بحث متقدم وتصفية حسب الفرع والحالة والوسيط",
    ],
    decorBadges: ["ملف طبي", "سائق إضافي", "تاريخ الوثائق"],
  },
  {
    icon: FileText,
    title: "وثائق، باقات وتجديدات",
    desc: "إنشاء إلزامي + ثالث/شامل + خدمات طريق في باقة واحدة، وتجديدات ذكية.",
    tint: "bg-sky-50 text-sky-600",
    hoverTint: "group-hover:bg-sky-100",
    gradient: "linear-gradient(135deg, #f0f9ff 0%, #bae6fd 100%)",
    accent: "#0284c7",
    intro: "معالج إصدار وثيقة يدمج الإلزامي + الشامل + خدمات الطريق في باقة واحدة، مع حساب سعر تلقائي حسب قواعد كل شركة تأمين.",
    bullets: [
      "إصدار إلزامي + ثالث/شامل في باقة واحدة",
      "حساب السعر تلقائياً حسب قواعد كل شركة تأمين",
      "خدمات الطريق والحوادث مدمجة بالباقة",
      "تجديدات ذكية مع سجل كامل لكل وثيقة",
      "إلغاءات وتحويلات بين المركبات بضغطة زر",
    ],
    decorBadges: ["إلزامي", "شامل", "خدمات طريق"],
  },
  {
    icon: CreditCard,
    title: "تحصيل، شيكات وتقسيط",
    desc: "نقدي، شيكات ببنك وفرع، تقسيط داخلي، وربط بسداد Tranzila.",
    tint: "bg-emerald-50 text-emerald-600",
    hoverTint: "group-hover:bg-emerald-100",
    gradient: "linear-gradient(135deg, #ecfdf5 0%, #a7f3d0 100%)",
    accent: "#059669",
    intro: "نظام تحصيل كامل يدعم النقدي، الشيكات، التقسيط الداخلي والدفع ببطاقة الائتمان عبر Tranzila — مع متابعة حالة كل دفعة.",
    bullets: [
      "استلام شيكات مع تسجيل البنك والفرع والتاريخ",
      "تقسيط داخلي مع متابعة المستحقات على العميل",
      "إيصالات نقدية قابلة للطباعة وإرسال SMS",
      "ربط مباشر مع Tranzila لدفع بطاقات الائتمان",
      "تتبع حالة كل دفعة: مكتمل، مرفوض، معلّق",
    ],
    decorBadges: ["شيكات", "Tranzila", "تقسيط داخلي"],
  },
  {
    icon: Wallet,
    title: "محفظة الوسطاء والتسويات",
    desc: "حساب الوسيط، أرباحه، تسوياته — بدون جداول إكسل يدوية.",
    tint: "bg-amber-50 text-amber-600",
    hoverTint: "group-hover:bg-amber-100",
    gradient: "linear-gradient(135deg, #fffbeb 0%, #fde68a 100%)",
    accent: "#d97706",
    intro: "محفظة مالية لكل وسيط تحسب العمولات تلقائياً على كل وثيقة، وتدير التسويات مع الوسطاء وشركات التأمين من لوحة واحدة.",
    bullets: [
      "حساب العمولات تلقائياً على كل وثيقة",
      "تسويات الوسطاء مع تتبع الأرصدة والمستحقات",
      "تسويات مع شركات التأمين بأسعارهم ودفعاتهم",
      "محفظة كاملة: الدخل، المصاريف وصافي الربح",
      "تقارير مفصلة لكل وسيط وكل شركة تأمين",
    ],
    decorBadges: ["عمولات", "تسويات", "أرصدة حيّة"],
  },
  {
    icon: MessageSquare,
    title: "تذكيرات SMS تلقائية",
    desc: "تذكير قبل انتهاء الوثيقة، وحملات تسويقية جماعية بضغطة زر.",
    tint: "bg-rose-50 text-rose-600",
    hoverTint: "group-hover:bg-rose-100",
    gradient: "linear-gradient(135deg, #fff1f2 0%, #fecdd3 100%)",
    accent: "#e11d48",
    intro: "تذكيرات ذكية وحملات SMS جماعية: النظام يُرسل قبل الانتهاء، في عيد الميلاد، وعند انتهاء الرخصة — بدون تدخّل يدوي.",
    bullets: [
      "تذكيرات قبل انتهاء الوثيقة (شهر وأسبوع)",
      "حملات SMS جماعية مع اختيار عملاء متعدد",
      "نماذج رسائل مخصّصة لكل نوع تنبيه",
      "تذكيرات عيد الميلاد وانتهاء الرخصة تلقائياً",
      "تتبع حالة الإرسال مع تقارير DLR",
    ],
    decorBadges: ["تذكيرات", "حملات", "تقارير DLR"],
  },
  {
    icon: BarChart3,
    title: "تقارير مالية لحظية",
    desc: "أرباح، عمولات، ديون، وتقارير متعددة الفروع بالوقت الفعلي.",
    tint: "bg-violet-50 text-violet-600",
    hoverTint: "group-hover:bg-violet-100",
    gradient: "linear-gradient(135deg, #f5f3ff 0%, #ddd6fe 100%)",
    accent: "#7c3aed",
    intro: "تقارير مالية محدّثة بالوقت الفعلي: أرباح، عمولات، أرصدة مستحقة وتقارير متعددة الفروع — مع تصدير فوري لـ Excel.",
    bullets: [
      "تقارير أرباح مع تفصيل العمولات والمصاريف",
      "متابعة الأرصدة المستحقة لكل شركة تأمين",
      "رصيد الخزينة مع فصل الدخل عن المصروفات",
      "تقارير متعددة الفروع مع مقارنات زمنية",
      "تصدير كامل إلى Excel بحسابات مفصّلة",
    ],
    decorBadges: ["أرباح حيّة", "متعدد الفروع", "تصدير Excel"],
  },
];

const featureTabs = [
  {
    id: "invoicing",
    label: "إصدار وتسعير",
    num: "01",
    title: "إصدار وثائق التأمين بضغطة واحدة.",
    desc: "إنشاء وثائق جديدة، تجديدات وحزم تأمين مخصصة — مع حساب سعر تلقائي حسب قواعد التسعير لكل شركة تأمين.",
    stats: [
      { value: "3", unit: "دقائق", label: "متوسط الوقت لإصدار وثيقة تأمين جديدة كاملة." },
      { value: "100%", unit: "", label: "دقة في حساب الأسعار والعمولات تلقائياً." },
    ],
  },
  {
    id: "claims",
    label: "إدارة المطالبات",
    num: "02",
    title: "المطالبات تُغلق أسرع،\nبدون مراسلات لا نهائية.",
    desc: "إدارة مطالبات ذكية مع تحديثات تلقائية للعميل، جمع مستندات رقمي ومزامنة كاملة مع شركات التأمين. العميل يبقى على اطلاع، وأنت متفرّغ للبيع التالي.",
    stats: [
      { value: "12", unit: "دقيقة", label: "متوسط الوقت الموفّر للوكيل على فتح مطالبة وتحديث الحالة مع شركات التأمين، بفضل مزامنة البيانات التلقائية." },
      { value: "65%", unit: "", label: "تقليص في وقت جمع المستندات من العميل. النظام يرسل طلبات تلقائية ويبدأ الملفات مباشرة في ملف المطالبة بدون تدخل يدوي." },
    ],
  },
  {
    id: "marketing",
    label: "أتمتة التسويق",
    num: "03",
    title: "تسويق تلقائي يعمل من أجلك.",
    desc: "إرسال SMS وحملات تلقائية للعملاء، تذكيرات تجديد، تحديثات عروض والحفاظ على العملاء — كل شيء بدون جهد يدوي.",
    stats: [
      { value: "40%", unit: "", label: "ارتفاع في نسبة تجديد الوثائق بفضل التذكيرات التلقائية." },
      { value: "5K+", unit: "", label: "رسائل SMS تُرسل شهرياً عبر النظام." },
    ],
  },
  {
    id: "bi",
    label: "رقابة وتحليلات",
    num: "04",
    title: "سيطرة كاملة على البيانات.",
    desc: "تقارير ربحية، متابعة عمولات، تحليل أداء الوكلاء ونظرة شاملة على جميع الفروع — بالوقت الفعلي وبضغطة واحدة.",
    stats: [
      { value: "50%", unit: "", label: "توفير في وقت إعداد التقارير المالية." },
      { value: "∞", unit: "", label: "تقارير مخصصة بلا حدود." },
    ],
  },
  {
    id: "cx",
    label: "تجربة العميل",
    num: "05",
    title: "تجربة عميل تبيع نفسها.",
    desc: "توقيعات رقمية، بوابة عميل، تواصل مباشر عبر WhatsApp ومتابعة كل تفاعل — عملاؤك سيشعرون بالفرق.",
    stats: [
      { value: "95%", unit: "", label: "رضا العملاء عن الواجهة الرقمية." },
      { value: "24/7", unit: "", label: "وصول ذاتي للعميل للوثائق والمستندات." },
    ],
  },
];

export default function Landing() {
  usePageView("/landing");
  const { data: content } = useLandingContent();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("claims");
  const [slideIdx, setSlideIdx] = useState(0);
  const [testimonialIdx, setTestimonialIdx] = useState(0);
  const [testimonialAnim, setTestimonialAnim] = useState<"in" | "out">("in");
  const [faqCategory, setFaqCategory] = useState("general");
  // Section-2 feature tile → pro modal. Index points at the tile in
  // the `featureTiles` array below (null = closed). Body scroll is
  // frozen while open and ESC closes — so the modal behaves like a
  // real dialog, not a popover.
  const [openTile, setOpenTile] = useState<number | null>(null);
  useEffect(() => {
    if (openTile === null) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenTile(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [openTile]);
  // Track scroll to drive the nav's sticky pill transition + the top
  // marquee's slide-up close. `scrolled` flips true once the user is
  // past a small threshold and stays true until they scroll back up.
  // `scrolled` is still a React state because the logo / link colors
  // don't depend on it any more, but some conditional bits (e.g. the
  // marquee's aria-hidden) still want the boolean. Kept cheap — flips
  // at most once when crossing the 8 px threshold.
  const [scrolled, setScrolled] = useState(false);
  // Scroll-linked chrome — driven DIRECTLY on the DOM via refs in a
  // requestAnimationFrame loop, NOT through React state. A large page
  // like Landing re-rendering on every scroll tick was adding its own
  // lag on top of the animation, especially on the way back to the
  // top where the user is actively scrolling while the lerp settles.
  // By writing to `.style` on pinned refs we bypass React entirely on
  // every frame — the nav tracks the scroll 1:1 with no reconciler
  // cost per event.
  const marqueeChromeRef = useRef<HTMLDivElement | null>(null);
  const navPillRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let ticking = false;
    let lastScrolled = false;
    const apply = () => {
      const y = window.scrollY;
      const p = Math.min(1, Math.max(0, y / 90));
      const inv = 1 - p;
      const m = marqueeChromeRef.current;
      if (m) {
        m.style.maxHeight = `${60 * inv}px`;
        m.style.paddingTop = `${12 * inv}px`;
        m.style.paddingBottom = `${12 * inv}px`;
        m.style.opacity = String(inv);
        m.style.transform = `translate3d(0, ${-60 * p}px, 0)`;
        m.style.pointerEvents = p > 0.5 ? "none" : "auto";
      }
      const n = navPillRef.current;
      if (n) {
        n.style.width = `${90 - 6 * p}%`;
        n.style.maxWidth = `${96 - 32 * p}rem`;
        n.style.marginTop = `${12 * p}px`;
        n.style.borderRadius = `${9999 * p}px`;
        n.style.transform = `translate3d(0, ${44 * inv}px, 0)`;
        if (p > 0.02) {
          n.style.backdropFilter = "blur(8px)";
          (n.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = "blur(8px)";
        } else {
          n.style.backdropFilter = "none";
          (n.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = "none";
        }
        n.style.backgroundColor = `rgba(255, 255, 255, ${0.8 * p})`;
        n.style.boxShadow = `0 1px 20px 0 rgba(0, 0, 0, ${0.12 * p})`;
      }
      const isScrolled = y > 8;
      if (isScrolled !== lastScrolled) {
        lastScrolled = isScrolled;
        setScrolled(isScrolled);
      }
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        apply();
        ticking = false;
      });
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Hero video — force playback after mount. Autoplay is fragile
  // (Safari + some privacy modes block it until the element is ready,
  // not when the attribute appears). Pin the speed and retry .play()
  // on every readiness event so the motion is actually running.
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = heroVideoRef.current;
    if (!el) return;
    el.playbackRate = HERO_VIDEO_SPEED;
    const tryPlay = () => {
      el.playbackRate = HERO_VIDEO_SPEED;
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => { /* ignore */ });
    };
    tryPlay();
    el.addEventListener("canplay", tryPlay);
    el.addEventListener("loadeddata", tryPlay);
    return () => {
      el.removeEventListener("canplay", tryPlay);
      el.removeEventListener("loadeddata", tryPlay);
    };
  }, []);

  // Top marquee — JS-driven scroll, dynamically padded so the track
  // always covers more than the viewport. rAF loop measures group1's
  // width every frame; when the running offset reaches -groupWidth we
  // add groupWidth back, so the snap is by exactly one pixel-identical
  // group width (no sub-pixel gap possible). On mount we also measure
  // against innerWidth and, if a single group is narrower than the
  // viewport, ask React to render extra clones so the track always
  // covers at least 2× viewport — that's what prevents the blank on
  // wider monitors.
  const marqueeTrackRef = useRef<HTMLDivElement | null>(null);
  const marqueeGroupRef = useRef<HTMLDivElement | null>(null);
  const [marqueeClones, setMarqueeClones] = useState(3);
  useEffect(() => {
    const group = marqueeGroupRef.current;
    if (!group) return;
    const measure = () => {
      const groupW = group.offsetWidth;
      const vw = window.innerWidth || 0;
      if (groupW <= 0 || vw <= 0) return;
      // We want total track width ≥ 2 × viewport so the wrap (by 1
      // groupWidth) always leaves at least one extra groupWidth of
      // content visible on the leading edge. clones = number of
      // additional identical groups after the primary one.
      const needed = Math.max(1, Math.ceil((2 * vw) / groupW));
      setMarqueeClones((prev) => (prev >= needed ? prev : needed));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => {
    const track = marqueeTrackRef.current;
    const group = marqueeGroupRef.current;
    if (!track || !group) return;
    const SPEED_PX_PER_SEC = 35;
    let offset = 0;
    let lastTs = performance.now();
    let raf = 0;
    const loop = (ts: number) => {
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      const groupW = group.offsetWidth;
      if (groupW > 0) {
        offset -= SPEED_PX_PER_SEC * dt;
        if (offset <= -groupW) offset += groupW;
        track.style.transform = `translate3d(${offset}px, 0, 0)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // CMS-driven images with fallbacks
  const dashboardMockup = ci(content, "dashboard_mockup_image", dashboardMockupDefault);
  const featuresMockup = ci(content, "features_mockup_image", featuresMockupDefault);
  const featureProfitEngine = ci(content, "benefit_card_1_image", featureProfitEngineDefault);
  const featurePaperless = ci(content, "benefit_card_2_image", featurePaperlessDefault);
  const featureMarketing = ci(content, "benefit_card_3_image", featureMarketingDefault);
  const sliderBg = ci(content, "slider_bg_image", sliderBgDefault);
  const gridLogoBg = ci(content, "grid_logo_bg_image", gridLogoBgDefault);

  const testimonials = [
    {
      quote: "أهم شيء بالنسبة لي في النظام هو الدقة. قبل Thiqa كنت أفقد عمولات وألاحق شيكات في ملفات إكسل. اليوم المحرك المالي يعمل كل شيء لوحده —",
      highlight: "أعرف بالضبط كم ربحت من كل وثيقة وما هو الرصيد مع كل شركة. هذا هدوء بال لم يكن عندي لسنوات.",
      name: "ماهر سليمان,",
      role: "مدير وكالة تأمين",
    },
    {
      quote: "منذ أن انتقلنا لـ Thiqa وفرنا ساعات عمل كل يوم. التقارير التلقائية والتذكيرات الذكية غيّرت لنا الوكالة.",
      highlight: "لا أفوّت أي تجديد ولا أفقد أي عميل. النظام يعمل من أجلي 24/7.",
      name: "أحمد خالد,",
      role: "وكيل تأمين — حيفا",
    },
    {
      quote: "الدعم ممتاز والنظام سهل الاستخدام. خلال أسبوع كل فريقي كان يعمل على Thiqa بشكل سلس.",
      highlight: "التصدير لإكسل والتقارير المالية وفرت عليّ محاسب. ببساطة مثالي.",
      name: "يوسف كنعان,",
      role: "وكيل تأمين — الناصرة",
    },
  ];

  const goTestimonial = (dir: "up" | "down") => {
    setTestimonialAnim("out");
    setTimeout(() => {
      setTestimonialIdx((p) =>
        dir === "down"
          ? (p + 1) % testimonials.length
          : (p - 1 + testimonials.length) % testimonials.length
      );
      setTestimonialAnim("in");
    }, 350);
  };

  return (
    <div className="min-h-screen text-black overflow-x-hidden bg-white" dir="rtl" style={{ fontFamily: "'Cairo', sans-serif" }}>

      {/* Hero entrance animation — staggered fade + rise for each block
          so the landing reveals itself instead of slamming in all at
          once. Uses a smooth expo-out easing and per-element delays
          via inline animationDelay so the cascade is predictable. */}
      <style>{`
        @keyframes heroReveal {
          0% { opacity: 0; transform: translateY(28px); filter: blur(6px); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        @keyframes heroScaleIn {
          0% { opacity: 0; transform: scale(0.96) translateY(20px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .hero-reveal {
          opacity: 0;
          animation: heroReveal 1.1s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .hero-scale-in {
          opacity: 0;
          animation: heroScaleIn 1.3s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
      `}</style>

      {/* ═══ Top marquee — CRM feature keywords ═══
          JS-driven infinite scroll. dir="ltr" is critical: the page is
          RTL, and in a default-direction flex row RTL places the first
          child on the RIGHT and clones extend leftward — then shifting
          the track left empties the right-hand viewport edge (the
          "blank" the user kept reporting). Forcing LTR on the marquee
          wrapper puts the primary group on the LEFT and clones on the
          RIGHT, so translating left reveals those clones as they slide
          in from off-screen-right. The inner Arabic text still renders
          its own RTL direction via each item's natural bidi. */}
      <div
        ref={marqueeChromeRef}
        dir="ltr"
        className="relative bg-white overflow-hidden transform-gpu origin-top will-change-[max-height,opacity,transform]"
        style={{
          // Initial values — the rAF loop rewrites these on every
          // scroll event. React never re-runs to update them.
          maxHeight: "60px",
          paddingTop: "12px",
          paddingBottom: "12px",
          opacity: 1,
          transform: "translate3d(0, 0, 0)",
        }}
        aria-label="مزايا النظام"
        aria-hidden={scrolled}
      >
        {/* Edge fades so items dissolve into the white bg at both ends
            instead of hard-clipping at the viewport edges. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 z-10 bg-gradient-to-l from-white to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 z-10 bg-gradient-to-r from-white to-transparent" />

        <div
          ref={marqueeTrackRef}
          className="flex items-center w-max will-change-transform"
          style={{ transform: "translate3d(0, 0, 0)" }}
        >
          {(() => {
            const items = [
              { icon: Users, label: "إدارة العملاء والمركبات" },
              { icon: FileText, label: "وثائق، تجديدات وباقات تأمين" },
              { icon: RefreshCcw, label: "تجديد تلقائي مع تذكيرات SMS" },
              { icon: CreditCard, label: "تحصيل وشيكات وتقسيط" },
              { icon: Wallet, label: "محفظة الوسطاء والعمولات" },
              { icon: BarChart3, label: "تقارير ربحية لحظية" },
              { icon: MessageSquare, label: "حملات SMS تسويقية" },
              { icon: Shield, label: "بيانات آمنة بتشفير كامل" },
              { icon: Bell, label: "إشعارات انتهاء الوثائق" },
              { icon: Phone, label: "توقيعات رقمية عن بعد" },
            ];
            const renderItem = (
              { icon: Icon, label }: { icon: typeof Users; label: string },
              key: string,
            ) => (
              // dir="rtl" keeps each item's internal layout (icon → text
              // → dot) reading right-to-left like the rest of the UI,
              // even though the outer flex track is LTR for the scroll.
              <div
                key={key}
                dir="rtl"
                className="flex items-center gap-2.5 shrink-0 text-black/70 px-5"
              >
                <Icon className="h-4 w-4 text-black/50" />
                <span className="text-[13px] font-medium whitespace-nowrap">
                  {label}
                </span>
                <span className="mx-2 text-black/25 select-none">•</span>
              </div>
            );
            return (
              <>
                {/* Primary group — its measured width drives the wrap. */}
                <div ref={marqueeGroupRef} className="flex items-center shrink-0">
                  {items.map((it, i) => renderItem(it, `a-${i}`))}
                </div>
                {/* N identical clones. The resize effect picks N so
                    total track width ≥ 2 × viewport — guarantees at
                    least one full extra group stays visible after the
                    wrap, so the leading edge never reveals a blank
                    even on ultrawide monitors. */}
                {Array.from({ length: marqueeClones }).map((_, cIdx) => (
                  <div
                    key={`c-${cIdx}`}
                    className="flex items-center shrink-0"
                    aria-hidden="true"
                  >
                    {items.map((it, i) => renderItem(it, `c-${cIdx}-${i}`))}
                  </div>
                ))}
              </>
            );
          })()}
        </div>
      </div>

      {/* ═══ Navbar — fixed to the viewport so it follows the scroll.
          The outer wrapper stays at top-0 always; the inner pill
          translates down 44 px when the marquee is open and slides
          up to 0 on scroll. translateY is GPU-composited, so there's
          no reflow jank — the nav tracks the scroll smoothly instead
          of "freezing" while the old top-property animation repaints
          the layout each frame. */}
      <nav className="fixed inset-x-0 top-0 z-50 pointer-events-none mt-2">
        <div
          ref={navPillRef}
          className="pointer-events-auto flex items-center justify-between px-6 h-14 md:h-16 mx-auto transform-gpu will-change-[transform,background-color,border-radius,box-shadow]"
          style={{
            // Initial (unscrolled) values — rewritten per-frame by
            // the rAF loop above without going through React.
            width: "90%",
            maxWidth: "96rem",
            marginTop: "0px",
            borderRadius: "0px",
            transform: "translate3d(0, 44px, 0)",
            backdropFilter: "none",
            WebkitBackdropFilter: "none",
            backgroundColor: "rgba(255, 255, 255, 0)",
            boxShadow: "none",
            border: "none",
          }}
        >
          {/* Logo — always the black variant. currentColor on the
              wordmark inherits from the wrapper's text-black. */}
          <div className="flex items-center text-black">
            <ThiqaLogoAnimation
              iconSize={32}
              interactive={false}
              iconSrc="https://thiqacrm.b-cdn.net/small_black.png"
            />
          </div>

          <div className="hidden md:flex items-center gap-10 text-[14px] font-medium text-black/70">
            <a href="#features" className="transition-colors hover:text-black">لماذا نحن مختلفون</a>
            <a href="#demo" className="transition-colors hover:text-black">كيف يعمل</a>
            <a href="#faq" className="transition-colors hover:text-black">أسئلة وأجوبة</a>
            <a href="/pricing" className="transition-colors hover:text-black">الأسعار</a>
          </div>

          {/* CTA pill — black text always. Over the hero it sits on the
              translucent white-ring style (so the ring + drop shadow
              read against whatever's behind); on the scrolled white
              pill it shifts to a black-ring style for contrast. */}
          <button
            onClick={() => { trackEvent("signup_click", "/landing"); navigate("/login?view=signup"); }}
            className={cn(
              "px-6 py-2 text-[13px] font-bold text-black transition-all",
              scrolled ? "hover:bg-black/5" : "hover:bg-white/40",
            )}
            style={
              scrolled
                ? {
                    borderRadius: "100px",
                    border: "2px solid rgba(0, 0, 0, 0.18)",
                    background: "rgba(255, 255, 255, 0.0)",
                    boxShadow: "0 2px 8px 0 rgba(0, 0, 0, 0.06)",
                  }
                : {
                    borderRadius: "100px",
                    border: "2px solid rgba(255, 255, 255, 0.40)",
                    background: "rgba(255, 255, 255, 0.10)",
                    boxShadow: "0 4px 16px 0 rgba(0, 0, 0, 0.08)",
                  }
            }
          >
            {ct(content, "navbar_cta", "احصل على 35 يوم مجاناً")}
          </button>
        </div>
      </nav>

      {/* ═══ HERO with video background ═══
          justify-between (not justify-center) so the title block
          parks near the top with breathing room from the nav, and
          the mockup frame sticks to the bottom of the hero. */}
      <section className="relative min-h-screen flex flex-col items-center justify-between overflow-hidden">
        {/* Hero background layer. A soft light gradient sits under the
            video as a fallback — if autoplay is blocked or the file
            hasn't loaded yet, the hero is still a bright, branded
            surface instead of a black hole. */}
        <div
          className="absolute inset-0 z-0"
          style={{
            background:
              "linear-gradient(135deg, #eef1ff 0%, #ffffff 45%, #ffe8f0 100%)",
          }}
        >
          {/* Background video — autoplay, muted, loop, playsInline so
              iPhone Safari allows playback without going full-screen.
              Speed pinned to 1.5× via the effect above + the inline
              onPlay / onLoadedMetadata handlers so Safari can't reset
              it to 1× on the first play. */}
          <video
            ref={heroVideoRef}
            onPlay={reapplyHeroVideoSpeed}
            onLoadedMetadata={reapplyHeroVideoSpeed}
            className="w-full h-full object-cover block"
            src="https://thiqacrm.b-cdn.net/video.mp4"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
          />
          {/* Very light veil so the black hero text stays readable
              without washing out the motion behind it. */}
          <div className="absolute inset-0 bg-white/20" />
        </div>

        <div className="relative z-10 w-[90%] max-w-[56rem] mx-auto text-center pt-40 md:pt-44">
          <h1
            className="text-[1.6rem] md:text-[2.2rem] lg:text-[2.8rem] font-extrabold leading-[1.2] tracking-tight whitespace-pre-line hero-reveal text-black"
            style={{ animationDelay: '120ms' }}
          >
            {ct(content, "hero_title", "CRM لوكالات التأمين.\nأبسط، أسرع، أذكى.")}
          </h1>
          <p
            className="mt-5 text-[14px] md:text-[15px] text-black/70 max-w-xl mx-auto leading-relaxed whitespace-pre-line hero-reveal"
            style={{ animationDelay: '340ms' }}
          >
            {ct(content, "hero_subtitle", "إدارة الوثائق، الأموال والتسويق في مكان واحد — سريع وآمن.")}
          </p>
          <div className="mt-8 hero-reveal" style={{ animationDelay: '520ms' }}>
            {/* Solid white pill, no border — the user's explicit spec. */}
            <button
              onClick={() => navigate("/login?view=signup")}
              className="text-[15px] font-bold text-black px-9 py-3.5 transition-all hover:scale-[1.03] hover:shadow-[0_10px_28px_-6px_rgba(0,0,0,0.25)]"
              style={{
                borderRadius: '100px',
                background: '#FFF',
                border: 'none',
              }}
            >
              {ct(content, "hero_cta", "احصل على 35 يوم مجاناً")}
            </button>
          </div>
        </div>

        {/* Hero framed mockup — 50% of the viewport, stuck to the
            bottom of the hero section. Transparent frame so the rounded
            top corners sit cleanly on the video background. */}
        <div
          className="relative z-10 w-full mx-auto px-6 pb-0 hero-scale-in flex justify-center"
          style={{ animationDelay: '720ms' }}
        >
          <div
            className="relative rounded-t-xl overflow-hidden border border-black/[0.12] border-b-0 shadow-2xl shadow-black/20 max-w-full"
            style={{ width: '50%' }}
          >
            <img
              src="https://thiqacrm.b-cdn.net/1new.png"
              alt="Thiqa CRM Dashboard"
              width={607}
              height={407}
              className="w-full h-auto block"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ Section 2: Feature highlights ═══
          Six real Thiqa capabilities, each in its own tile.
          IntersectionObserver flips `.fb-visible` on the whole
          section when it first enters the viewport. Two things then
          animate:
            1. Label + title do an RTL typewriter reveal via
               clip-path + steps() — the clip window slides leftward
               so the Arabic text appears right-to-left like a real
               typist.
            2. Cards fade-up in sequence and grow a primary-color
               accent bar on their right edge on hover. */}
      <style>{`
        @keyframes fbTypeRtl {
          from { clip-path: inset(0 0 0 100%); }
          to   { clip-path: inset(0 0 0 0); }
        }
        /* Pre-animation state: fully clipped so text is invisible
           before IntersectionObserver flips .fb-visible. Once
           typing runs its course, clip-path lands at 0 and the
           final text reads as plain text — no cursor, no residual
           typing artifact. */
        .fb-type {
          display: inline-block;
          clip-path: inset(0 0 0 100%);
        }
        .fb-visible .fb-type-label {
          animation: fbTypeRtl 0.9s steps(18, end) 0.15s forwards;
        }
        .fb-visible .fb-type-title {
          animation: fbTypeRtl 1.5s steps(34, end) 0.85s forwards;
        }

        .fb-tile {
          opacity: 0;
          transform: translate3d(0, 24px, 0) scale(0.96);
          transition:
            opacity 0.7s cubic-bezier(0.22,1,0.36,1),
            transform 0.7s cubic-bezier(0.22,1,0.36,1),
            box-shadow 0.35s ease,
            border-color 0.35s ease;
        }
        .fb-visible .fb-tile {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
        .fb-tile:hover {
          transform: translate3d(0, -5px, 0) scale(1);
        }
        /* Right-edge accent bar — grows top-to-bottom on hover and
           tints in the primary brand color. */
        .fb-tile::before {
          content: "";
          position: absolute;
          top: 14%;
          bottom: 14%;
          right: 0;
          width: 3px;
          border-radius: 3px 0 0 3px;
          background: linear-gradient(180deg, #122143 0%, #4a6cc7 100%);
          transform: scaleY(0);
          transform-origin: top;
          transition: transform 0.5s cubic-bezier(0.22,1,0.36,1);
        }
        .fb-tile:hover::before {
          transform: scaleY(1);
        }
        /* Soft corner glow that fades in on hover. */
        .fb-tile::after {
          content: "";
          position: absolute;
          top: -40px;
          right: -40px;
          width: 140px;
          height: 140px;
          border-radius: 9999px;
          background: radial-gradient(circle, rgba(74,108,199,0.18) 0%, rgba(74,108,199,0) 70%);
          opacity: 0;
          transition: opacity 0.45s ease;
          pointer-events: none;
        }
        .fb-tile:hover::after {
          opacity: 1;
        }
        .fb-tile .fb-icon {
          transition: transform 0.35s cubic-bezier(0.22,1,0.36,1), background-color 0.25s ease, box-shadow 0.35s ease;
        }
        .fb-tile:hover .fb-icon {
          transform: rotate(-6deg) scale(1.08);
          box-shadow: 0 8px 24px -8px rgba(18, 33, 67, 0.35);
        }
        .fb-tile .fb-cta {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          color: #122143;
          font-size: 12px;
          font-weight: 700;
          opacity: 0;
          transform: translateX(6px);
          transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.22,1,0.36,1);
        }
        .fb-tile:hover .fb-cta {
          opacity: 1;
          transform: translateX(0);
        }

        /* ── Modal ────────────────────────────────────────────── */
        @keyframes fbBackdropIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes fbPanelIn {
          from { opacity: 0; transform: translateY(28px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        @keyframes fbHeroIconIn {
          from { opacity: 0; transform: scale(0.6) rotate(-12deg); }
          to   { opacity: 1; transform: scale(1)   rotate(0); }
        }
        @keyframes fbBadgeIn {
          from { opacity: 0; transform: translateY(8px) scale(0.9); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes fbBulletIn {
          from { opacity: 0; transform: translateX(-12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .fb-modal-backdrop {
          animation: fbBackdropIn 0.35s ease forwards;
        }
        .fb-modal-panel {
          opacity: 0;
          animation: fbPanelIn 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.05s forwards;
        }
        .fb-hero-icon {
          opacity: 0;
          animation: fbHeroIconIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.25s forwards;
        }
        .fb-badge {
          opacity: 0;
          animation: fbBadgeIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .fb-bullet {
          opacity: 0;
          animation: fbBulletIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
      `}</style>
      <section
        ref={(el) => {
          // Attach IntersectionObserver to toggle the .fb-visible
          // class once the section enters view. One-shot — once
          // visible, stays visible.
          if (!el) return;
          if ((el as HTMLElement & { __fbBound?: boolean }).__fbBound) return;
          (el as HTMLElement & { __fbBound?: boolean }).__fbBound = true;
          const io = new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                if (e.isIntersecting) {
                  e.target.classList.add("fb-visible");
                  io.disconnect();
                  break;
                }
              }
            },
            { threshold: 0.2 },
          );
          io.observe(el);
        }}
        className="py-20 md:py-28 bg-white"
      >
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-sm mb-3 tracking-wide font-semibold">
              <span className="fb-type fb-type-label text-[#4a6cc7]">كل ما تحتاجه وكالتك</span>
            </p>
            <h2 className="text-2xl md:text-[2.2rem] font-bold leading-tight" style={{ color: '#122143' }}>
              <span className="fb-type fb-type-title">أدوات حقيقية تعمل من اليوم الأول</span>
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-5">
            {featureTiles.map(({ icon: Icon, title, desc, tint, hoverTint }, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setOpenTile(i)}
                className="fb-tile group relative overflow-hidden rounded-2xl border border-black/[0.06] bg-white p-6 text-right hover:border-[#122143]/20 hover:shadow-[0_20px_50px_-14px_rgba(18,33,67,0.22)] cursor-pointer w-full"
                style={{ transitionDelay: `${i * 90}ms` }}
                aria-label={`افتح تفاصيل: ${title}`}
              >
                <div className="relative z-10">
                  <div className={cn("fb-icon inline-flex h-12 w-12 items-center justify-center rounded-xl mb-4", tint, hoverTint)}>
                    <Icon className="h-6 w-6" strokeWidth={2} />
                  </div>
                  <h3 className="text-[15px] font-bold mb-1.5" style={{ color: '#122143' }}>{title}</h3>
                  <p className="text-[13px] text-black/55 leading-relaxed">{desc}</p>
                  <div className="fb-cta mt-3">
                    اعرف المزيد
                    <ArrowLeft className="h-3 w-3" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ═══ Feature tile modal ═══
            Opens when a tile is clicked. Hero panel uses the tile's
            own gradient + icon + "decor badges" so each feature has
            its own on-brand visual (no stock imagery required). The
            bulleted capability list is sourced from `featureTiles`
            above, which itself was built by auditing the actual
            pages under src/pages/ — so everything the popup
            promises is a real, shipping feature. */}
        {openTile !== null && (() => {
          const tile = featureTiles[openTile];
          const Icon = tile.icon;
          return (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center p-4 md:p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby="fb-modal-title"
            >
              <div
                className="fb-modal-backdrop absolute inset-0 bg-[#0b1530]/60 backdrop-blur-md"
                onClick={() => setOpenTile(null)}
              />
              <div className="fb-modal-panel relative z-10 w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white shadow-[0_40px_100px_-20px_rgba(18,33,67,0.45)]">
                {/* Hero visual — gradient + big icon + decorative
                    sub-feature chips + soft grid. Per-tile accent
                    color keeps each popup visually distinct. */}
                <div
                  className="relative h-52 md:h-60 overflow-hidden"
                  style={{ background: tile.gradient }}
                  dir="rtl"
                >
                  <div
                    className="absolute inset-0 opacity-[0.18]"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle at 1px 1px, rgba(18,33,67,0.35) 1px, transparent 0)",
                      backgroundSize: "18px 18px",
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div
                      className="fb-hero-icon h-24 w-24 md:h-28 md:w-28 rounded-3xl bg-white/85 backdrop-blur-sm flex items-center justify-center"
                      style={{
                        boxShadow: `0 20px 60px -12px ${tile.accent}66`,
                      }}
                    >
                      <Icon className="h-12 w-12 md:h-14 md:w-14" strokeWidth={1.6} style={{ color: tile.accent }} />
                    </div>
                  </div>
                  {/* Floating chips — three sub-feature hints drawn
                      from `decorBadges`. Staggered fade-in. */}
                  {tile.decorBadges.map((badge, idx) => {
                    const positions = [
                      "top-5 right-5",
                      "bottom-6 right-10",
                      "top-10 left-6",
                    ];
                    return (
                      <span
                        key={idx}
                        className={cn(
                          "fb-badge absolute text-[11px] md:text-xs font-semibold px-3 py-1.5 rounded-full bg-white/90 backdrop-blur-sm border border-white shadow-sm",
                          positions[idx],
                        )}
                        style={{
                          color: tile.accent,
                          animationDelay: `${0.45 + idx * 0.12}s`,
                        }}
                      >
                        {badge}
                      </span>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setOpenTile(null)}
                    className="absolute top-4 left-4 h-9 w-9 rounded-full bg-white/90 hover:bg-white text-[#122143] flex items-center justify-center shadow-sm transition-colors"
                    aria-label="إغلاق"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="p-7 md:p-9 text-right" dir="rtl">
                  <h3
                    id="fb-modal-title"
                    className="text-xl md:text-[1.6rem] font-extrabold leading-tight mb-3"
                    style={{ color: "#122143" }}
                  >
                    {tile.title}
                  </h3>
                  <p className="text-[13px] md:text-sm text-black/65 leading-relaxed mb-6">
                    {tile.intro}
                  </p>

                  <ul className="space-y-3 mb-7">
                    {tile.bullets.map((b, idx) => (
                      <li
                        key={idx}
                        className="fb-bullet flex items-start gap-3"
                        style={{ animationDelay: `${0.35 + idx * 0.08}s` }}
                      >
                        <span
                          className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full flex items-center justify-center"
                          style={{ background: tile.accent }}
                        >
                          <Check className="h-3 w-3 text-white" strokeWidth={3} />
                        </span>
                        <span className="text-[13px] md:text-sm text-black/80 leading-relaxed">
                          {b}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={() => {
                      setOpenTile(null);
                      navigate("/login?view=signup");
                    }}
                    className="w-full md:w-auto flex items-center justify-center gap-2 px-8 py-3.5 rounded-full text-white font-bold text-sm transition-transform hover:scale-[1.02]"
                    style={{
                      background: "#122143",
                      boxShadow: "0 12px 30px -8px rgba(18,33,67,0.4)",
                    }}
                  >
                    جرّب هذه الميزة مجاناً
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      <section id="features" className="py-24 md:py-36 relative bg-white">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <p className="text-sm text-black/50 mb-4 tracking-wide">{ct(content, "benefits_section_label", "البيت الرقمي لوكالتك")}</p>
          <h2 className="text-3xl md:text-[2.8rem] font-bold leading-tight mb-4 text-black">
            {ct(content, "benefits_section_title", "كل الأدوات لإدارة الوكالة تحت سقف واحد")}
          </h2>
          <p className="text-black/55 text-sm max-w-xl mx-auto mb-16">
            {ct(content, "benefits_section_subtitle", "بنية تقنية متقدمة توفر لك الوقت، تمنع الأخطاء وتزيد الربحية.")}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
            {[
              {
                img: featureProfitEngine,
                title: ct(content, "benefit_card_1_title", "محرك حساب أرباح تلقائي."),
                desc: ct(content, "benefit_card_1_desc", "إدارة تدفقات الشيكات، تحصيل بطاقات ائتمان وتسوية مع الوسطاء وشركات التأمين بدقة 100%. بدون خسارة عمولات وبدون حسابات يدوية."),
              },
              {
                img: featurePaperless,
                title: ct(content, "benefit_card_2_title", "صفر أوراق، أقصى سرعة."),
                desc: ct(content, "benefit_card_2_desc", "إرسال وثائق للتوقيع الرقمي عبر SMS، إدارة مستندات آمنة في السحابة ومتابعة كاملة لدورة حياة الوثيقة — كل شيء من الكمبيوتر أو الجوال."),
              },
              {
                img: featureMarketing,
                title: ct(content, "benefit_card_3_title", "تحويل البيانات إلى مبيعات."),
                desc: ct(content, "benefit_card_3_desc", "نظام تسويق مدمج لإرسال حملات عبر SMS وبريد إلكتروني. تذكيرات تلقائية للتجديدات، تحديثات عروض والحفاظ على العملاء بشكل فعّال."),
              },
            ].map((card, i) => (
              <div key={i} className="rounded-2xl border border-black/[0.08] bg-black/[0.02] overflow-hidden text-center shadow-sm">
                <div className="aspect-[4/3] overflow-hidden bg-black/[0.03]">
                  <img src={card.img} alt="" className="w-full h-full object-cover" loading="lazy" />
                </div>
                <div className="p-6 pt-5">
                  <h3 className="text-lg font-bold mb-2 text-black">{card.title}</h3>
                  <p className="text-sm text-black/60 leading-relaxed">{card.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => navigate("/login?view=signup")}
            className="px-10 py-4 text-[15px] font-bold text-white hover:opacity-90 transition-opacity"
            style={{
              borderRadius: '100px',
              background: '#111',
              boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.12)',
            }}
          >
            احصل على 35 يوم مجاناً
          </button>
        </div>
      </section>

      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      <section id="demo" className="py-24 md:py-36 relative bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-sm text-[#4a6cc7] mb-4 tracking-wide font-semibold">{ct(content, "showcase_label", "لماذا Thiqa بالذات؟")}</p>
            <h2 className="text-3xl md:text-[2.8rem] font-bold leading-tight mb-4 text-black">
              {ct(content, "showcase_title", "كل الأدوات لإدارة الوكالة تحت سقف واحد")}
            </h2>
            <p className="text-black/55 text-sm max-w-xl mx-auto">
              {ct(content, "showcase_subtitle", "بنية تقنية متقدمة توفر لك الوقت، تمنع الأخطاء وتزيد الربحية.")}
            </p>
          </div>

          {/* Tabs */}
          <div className="flex overflow-x-auto border border-black/[0.08] rounded-xl mb-0 bg-white">
            {featureTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 min-w-[140px] px-4 py-4 text-center border-l border-black/[0.08] first:border-l-0 transition-colors ${
                  activeTab === tab.id
                    ? "bg-black/[0.04] text-black"
                    : "text-black/50 hover:text-black/75 hover:bg-black/[0.02]"
                }`}
              >
                <span className="text-xs text-black/40 block mb-1">{tab.num}</span>
                <span className="text-sm font-semibold">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {featureTabs.filter(t => t.id === activeTab).map(tab => (
            <div key={tab.id} className="grid grid-cols-1 lg:grid-cols-2 gap-0 border border-black/[0.08] border-t-0 rounded-b-xl overflow-hidden bg-white">
              <div className="p-8 lg:p-12 flex flex-col justify-center order-1 lg:order-none">
                <h3 className="text-2xl md:text-3xl font-bold mb-4 leading-tight whitespace-pre-line text-black">{tab.title}</h3>
                <p className="text-black/60 text-sm leading-relaxed mb-8">{tab.desc}</p>

                <div className="grid grid-cols-2 gap-6">
                  {tab.stats.map((stat, j) => (
                    <div key={j}>
                      <div className="text-3xl font-extrabold text-black">
                        {stat.value}<span className="text-lg font-medium text-black/55 mr-1">{stat.unit}</span>
                      </div>
                      <p className="text-xs text-black/50 mt-2 leading-relaxed">{stat.label}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8">
                  <button
                    onClick={() => navigate("/login?view=signup")}
                    className="flex items-center gap-2 px-6 py-3 text-sm font-bold text-black hover:bg-black/[0.06] transition-colors bg-black/[0.03] border border-black/[0.12] rounded-lg"
                  >
                    ابدأ التجربة الآن
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="bg-gradient-to-br from-[#eef1ff] to-[#e4eaff] min-h-[300px] lg:min-h-[400px] flex items-center justify-center order-2 lg:order-none">
                <img src={featuresMockup} alt="" className="w-full h-full object-cover" loading="lazy" />
              </div>
            </div>
          ))}
        </div>
      </section>


      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ Section 5: Slider ═══ */}
      <section className="relative py-24 md:py-36 overflow-hidden bg-white">
        {/* Subtle light gradient so the slider section has its own
            rhythm without going dark. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, #f5f7ff 0%, #ffffff 50%, #fff3f7 100%)",
          }}
        />

        <div className="relative z-10">
          <h2 className="text-3xl md:text-[2.8rem] font-bold text-center mb-16 text-black">
            {ct(content, "slider_title", "لا تنتظر التجديد. اصنعه بنفسك")}
          </h2>

          {(() => {
            const slides = [
              {
                title: "إدارة مستندات آمنة في السحابة",
                desc: "كل المستندات، الوثائق والإيصالات — منظمة في السحابة مع وصول فوري من الكمبيوتر أو الجوال.",
                cta: "ابدأ التجربة الآن",
              },
              {
                title: "راحة بال والحفاظ على العملاء",
                desc: "لا تترك العميل يشعر بأنه وحيد في لحظة الحقيقة. النظام يدير لك جمع المستندات، يحدّث العميل بحالة المطالبة تلقائياً، ويتأكد أن لا مطلب من شركة التأمين يضيع. أنت تقدم خدمة VIP، بينما الأتمتة تقوم بالعمل الشاق.",
                cta: "ابدأ التجربة الآن",
              },
              {
                title: "تقارير مالية بضغطة زر",
                desc: "تقارير أرباح، مدفوعات وأرصدة — كل شيء تلقائي ومحدّث بالوقت الفعلي، مع تصدير فوري.",
                cta: "ابدأ التجربة الآن",
              },
            ];

            const goNext = () => setSlideIdx((p) => (p + 1) % slides.length);
            const goPrev = () => setSlideIdx((p) => (p - 1 + slides.length) % slides.length);

            return (
              <>
                <div className="relative flex items-stretch w-full">
                  <div className="hidden lg:flex flex-shrink-0 w-[14%] opacity-60 transition-all duration-500">
                    <div className="rounded-2xl overflow-hidden bg-black/[0.04] border border-black/[0.08] p-6 flex items-center justify-center w-full cursor-pointer hover:bg-black/[0.07] transition-colors" onClick={goPrev}>
                      <h3 className="text-base font-bold text-center text-black/70">{slides[(slideIdx - 1 + slides.length) % slides.length].title}</h3>
                    </div>
                  </div>

                  <div className="flex-1 transition-all duration-500 mx-3 lg:mx-5">
                    <div className="rounded-2xl overflow-hidden bg-white border border-black/[0.08] shadow-lg flex flex-col h-full">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 flex-1">
                        <div className="flex items-center justify-center p-6 md:p-10 order-2 md:order-1 bg-black/[0.02]">
                          <img src={featuresMockup} alt="" className="max-h-[300px] object-contain rounded-lg" loading="lazy" />
                        </div>
                        <div className="p-8 md:p-12 flex flex-col justify-center order-1 md:order-2">
                          <h3 className="text-xl md:text-2xl font-bold mb-4 text-black">{slides[slideIdx].title}</h3>
                          <p className="text-sm text-black/60 leading-relaxed mb-8">{slides[slideIdx].desc}</p>
                          <button
                            onClick={() => navigate("/login?view=signup")}
                            className="flex items-center gap-2 px-6 py-3 text-sm font-bold text-black hover:bg-black/[0.06] transition-colors bg-black/[0.03] border border-black/[0.12] rounded-lg w-fit"
                          >
                            <ArrowLeft className="h-4 w-4" />
                            {slides[slideIdx].cta}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="hidden lg:flex flex-shrink-0 w-[14%] opacity-60 transition-all duration-500">
                    <div className="rounded-2xl overflow-hidden bg-black/[0.04] border border-black/[0.08] p-6 flex items-center justify-center w-full cursor-pointer hover:bg-black/[0.07] transition-colors" onClick={goNext}>
                      <h3 className="text-base font-bold text-center text-black/70">{slides[(slideIdx + 1) % slides.length].title}</h3>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center gap-3 mt-10">
                  <button onClick={goPrev} className="h-11 w-11 rounded-full bg-black/[0.06] hover:bg-black/[0.12] text-black flex items-center justify-center transition-colors">
                    <ChevronLeft className="h-5 w-5 rotate-180" />
                  </button>
                  <button onClick={goNext} className="h-11 w-11 rounded-full bg-black/[0.06] hover:bg-black/[0.12] text-black flex items-center justify-center transition-colors">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      </section>


      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ Section 5: Grid Logo ═══ */}
      <section className="relative py-24 md:py-36 overflow-hidden bg-white">
        <div className="relative z-10 text-center px-6">
          <p className="text-sm text-black/55 mb-4 tracking-wide">{ct(content, "grid_label", "حل شامل وبسيط")}</p>
          <h2 className="text-3xl md:text-[2.8rem] font-bold leading-tight mb-10 text-black">
            {ct(content, "grid_title", "كل ما تحتاجه الوكالة، تحت سقف واحد")}
          </h2>
        </div>

        <div className="relative w-full max-w-5xl mx-auto">
          <img src={gridLogoBg} alt="" className="w-full h-auto" loading="lazy" />
        </div>

        <div className="relative z-10 text-center px-6 mt-10">
          <p className="text-sm text-black/55 max-w-xl mx-auto mb-8 leading-relaxed whitespace-pre-line">
            {ct(content, "grid_desc", "إرسال وثائق للتوقيع الرقمي عبر SMS، إدارة مستندات آمنة في السحابة\nومتابعة كاملة لدورة حياة الوثيقة — كل شيء من الكمبيوتر أو الجوال.")}
          </p>
          <button
            onClick={() => navigate("/login?view=signup")}
            className="px-8 py-3 text-[14px] font-bold text-white hover:opacity-90 transition-opacity"
            style={{
              borderRadius: '100px',
              background: '#111',
              boxShadow: '0 4px 16px 0 rgba(0, 0, 0, 0.12)',
            }}
          >
            {ct(content, "hero_cta", "احصل على 35 يوم مجاناً")}
          </button>
        </div>
      </section>


      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ Section 6: Testimonials ═══ */}
      <section id="testimonials" className="py-24 md:py-36 relative overflow-hidden bg-white">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(75, 110, 200, 0.08) 0%, rgba(100, 140, 220, 0.04) 40%, transparent 70%)',
          }}
        />
        <div className="relative max-w-6xl mx-auto px-6">
          <p className="text-sm text-[#4a6cc7] text-center mb-4 tracking-wide font-semibold">{ct(content, "testimonials_label", "قصص العملاء")}</p>
          <h2 className="text-3xl md:text-[2.8rem] font-bold text-center mb-16 text-black">
            {ct(content, "testimonials_title", "تعالوا اسمعوا ماذا يقول وكلاؤنا")}
          </h2>

          <div className="relative">
            <button
              onClick={() => goTestimonial("up")}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-14 hidden lg:flex h-11 w-11 rounded-full bg-black/[0.06] hover:bg-black/[0.12] text-black items-center justify-center transition-colors z-10"
            >
              <ChevronLeft className="h-5 w-5 rotate-180" />
            </button>
            <button
              onClick={() => goTestimonial("down")}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-14 hidden lg:flex h-11 w-11 rounded-full bg-black/[0.06] hover:bg-black/[0.12] text-black items-center justify-center transition-colors z-10"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div
              className="rounded-2xl overflow-hidden border border-black/[0.08] bg-white shadow-xl shadow-black/5"
            >
              <div
                className="grid grid-cols-1 md:grid-cols-[0.8fr_1.5fr] gap-0 transition-all duration-500"
                style={{
                  opacity: testimonialAnim === "in" ? 1 : 0,
                  transform: testimonialAnim === "in" ? "translateY(0)" : "translateY(30px)",
                  transition: "opacity 0.35s ease, transform 0.35s ease",
                }}
              >
                <div className="p-8 md:p-10 border-b md:border-b-0 md:border-l border-black/[0.08] flex flex-col justify-center gap-8 order-2 md:order-1 bg-black/[0.02]">
                  <div>
                    <div className="text-5xl md:text-6xl font-extrabold text-black ltr-nums">{ct(content, "testimonials_stat_1", "320+")}</div>
                    <p className="text-sm text-black/60 mt-2 leading-relaxed">{ct(content, "testimonials_stat_1_desc", "إرسال وثائق للتوقيع الرقمي عبر SMS، إدارة مستندات آمنة في السحابة ومتابعة كاملة")}</p>
                  </div>
                  <div>
                    <div className="text-5xl md:text-6xl font-extrabold text-black ltr-nums">{ct(content, "testimonials_stat_2", "50%")}</div>
                    <p className="text-sm text-black/60 mt-2 leading-relaxed">{ct(content, "testimonials_stat_2_desc", "إرسال وثائق للتوقيع الرقمي عبر SMS، إدارة مستندات آمنة في السحابة ومتابعة كاملة")}</p>
                  </div>
                </div>

                <div className="p-8 md:p-12 flex flex-col justify-center order-1 md:order-2">
                  <div className="text-5xl text-black/15 font-serif leading-none mb-4 text-left">״</div>
                  <p className="text-lg md:text-xl text-black/70 leading-relaxed mb-1">
                    {testimonials[testimonialIdx].quote}
                  </p>
                  <p className="text-lg md:text-xl text-black font-bold leading-relaxed mb-8">
                    {testimonials[testimonialIdx].highlight}
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-lg bg-black/[0.08] flex-shrink-0" />
                    <div>
                      <p className="font-bold text-black">{testimonials[testimonialIdx].name}</p>
                      <p className="text-sm text-black/55">{testimonials[testimonialIdx].role}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-center gap-2 mt-8">
              {testimonials.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-500 ${
                    i === testimonialIdx ? "w-10 bg-[#4a6cc7]" : "w-6 bg-black/[0.12]"
                  }`}
                />
              ))}
            </div>

            <div className="flex lg:hidden justify-center gap-3 mt-6">
              <button onClick={() => goTestimonial("up")} className="h-11 w-11 rounded-full bg-black/[0.06] hover:bg-black/[0.12] text-black flex items-center justify-center transition-colors">
                <ChevronLeft className="h-5 w-5 rotate-180" />
              </button>
              <button onClick={() => goTestimonial("down")} className="h-11 w-11 rounded-full bg-black/[0.06] hover:bg-black/[0.12] text-black flex items-center justify-center transition-colors">
                <ChevronLeft className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </section>


      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 md:py-36 relative bg-white">
        <div className="relative max-w-6xl mx-auto px-6">
          <p className="text-sm text-[#4a6cc7] text-center mb-4 tracking-wide font-semibold">{ct(content, "faq_label", "أسئلة وأجوبة")}</p>
          <h2 className="text-3xl md:text-[2.8rem] font-bold text-center mb-16 text-black">
            {ct(content, "faq_title", "كل ما يهمك معرفته عن Thiqa")}
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-8 md:gap-12">
            <div className="flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-4 md:pb-0">
              {[
                { key: "general", label: "عام ودعم" },
                { key: "pricing", label: "أسعار ومدفوعات" },
                { key: "features", label: "ميزات وإمكانيات" },
                { key: "security", label: "أمان وخصوصية" },
              ].map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setFaqCategory(cat.key)}
                  className={`whitespace-nowrap px-5 py-3 rounded-xl text-sm font-medium transition-all text-right ${
                    faqCategory === cat.key
                      ? "bg-black/[0.06] text-black border border-black/[0.1]"
                      : "text-black/55 hover:text-black/80 hover:bg-black/[0.03]"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-4">
              {(() => {
                const faqData: Record<string, { q: string; a: string }[]> = {
                  general: [
                    { q: "ما هو Thiqa؟", a: "نظام CRM متقدم مصمم خصيصاً لوكالات التأمين. إدارة العملاء، الوثائق، المدفوعات والتقارير — كل شيء في مكان واحد." },
                    { q: "هل البرنامج يدعم العربية؟", a: "نعم، النظام مبني بالعربية بالكامل مع واجهة RTL احترافية." },
                    { q: "هل يوجد دعم تقني؟", a: "نعم، فريق الدعم متاح بالهاتف وعبر واتساب في أيام العمل. متوسط وقت الرد: أقل من 30 دقيقة." },
                  ],
                  pricing: [
                    { q: "كم يكلف الاشتراك؟", a: "نقدم خطتين: Basic للوكالات الصغيرة و-Pro للوكالات الكبيرة مع جميع الميزات. تواصلوا معنا للتفاصيل." },
                    { q: "هل يوجد فترة تجريبية؟", a: "نعم، نقدم 35 يوم تجربة مجانية بدون الحاجة لبطاقة ائتمان." },
                    { q: "هل يمكن الإلغاء في أي وقت؟", a: "بالتأكيد. لا يوجد التزام ويمكن إلغاء الاشتراك في أي وقت." },
                  ],
                  features: [
                    { q: "هل يمكن استيراد بيانات من نظام قائم؟", a: "بالتأكيد. لدينا أداة استيراد مدمجة تدعم نقل البيانات من أنظمة WordPress ومصادر أخرى." },
                    { q: "هل يوجد تطبيق للجوال؟", a: "النظام متوافق بالكامل مع الجوال ويعمل بشكل ممتاز في أي متصفح على الهاتف." },
                    { q: "هل يوجد توقيع رقمي؟", a: "نعم، يمكن إرسال وثائق للتوقيع الرقمي عبر SMS والحصول على تأكيد فوري." },
                  ],
                  security: [
                    { q: "هل معلوماتي آمنة؟", a: "نعم، نستخدم تقنيات تشفير متقدمة مع نسخ احتياطية يومية تلقائية." },
                    { q: "أين يتم تخزين البيانات؟", a: "كل البيانات مخزنة في خوادم آمنة بمعايير أمان صارمة." },
                    { q: "من يمكنه الوصول لمعلوماتي؟", a: "أنتم فقط والمستخدمون الذين تعتمدونهم. يوجد نظام صلاحيات كامل." },
                  ],
                };
                return faqData[faqCategory]?.map((faq, i) => (
                  <details
                    key={i}
                    className="group p-5 rounded-2xl border border-black/[0.08] bg-black/[0.02] cursor-pointer transition-colors hover:bg-black/[0.04]"
                  >
                    <summary className="flex items-center justify-between font-semibold text-[15px] list-none text-black">
                      {faq.q}
                      <ChevronLeft className="h-4 w-4 text-black/40 transition-transform group-open:-rotate-90 shrink-0 mr-4" />
                    </summary>
                    <p className="mt-3 text-sm text-black/60 leading-relaxed">{faq.a}</p>
                  </details>
                ));
              })()}
            </div>
          </div>
        </div>
      </section>


      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ CTA ═══ */}
      <section className="relative overflow-hidden rounded-2xl mx-4 md:mx-8 lg:mx-16 my-8">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, #6b7fbc 0%, #a8b5d6 20%, #d4b8a0 40%, #c9a88a 55%, #9eadd4 75%, #7b93c8 100%)',
          }}
        />
        <div className="relative py-20 md:py-28 text-center px-6">
          <h2 className="text-3xl md:text-[2.8rem] font-bold mb-8 leading-tight text-[#1a1a2e]">
            لأن وكالتكم تستحق أكثر من إدارة عادية.
          </h2>
          <Button
            size="lg"
            onClick={() => navigate("/login?view=signup")}
            className="bg-white text-[#1a1a2e] hover:bg-white/90 rounded-full px-10 h-[52px] text-sm font-bold shadow-lg"
          >
            ابدأ الآن مجاناً
          </Button>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-black/[0.08] pt-16 pb-8 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col divide-y divide-black/[0.08]">
            {[
              { title: "معلومات", items: ["مركز المساعدة", "اتصل بنا"] },
              { title: "شروط وسياسات", items: ["شروط الاستخدام", "سياسة الخصوصية", "إمكانية الوصول"] },
              { title: "الدعم", items: ["دردشة الدعم", "أسئلة شائعة", "info@thiqa.co.il"] },
            ].map((section, idx) => (
              <details key={idx} className="group py-6">
                <summary className="flex items-center justify-between cursor-pointer list-none">
                  <span className="text-lg font-bold text-black">{section.title}</span>
                  <span className="text-black/55 text-2xl font-light group-open:hidden">+</span>
                  <span className="text-black/55 text-2xl font-light hidden group-open:inline">−</span>
                </summary>
                <ul className="mt-4 space-y-3 text-sm text-black/60 text-right">
                  {section.items.map((item, j) => (
                    <li key={j}><a href="#" className="hover:text-black transition-colors">{item}</a></li>
                  ))}
                </ul>
              </details>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-8 mb-8">
            <div className="h-1.5 w-1.5 rounded-full bg-black/25" />
            <div className="flex-1 h-px bg-black/[0.08]" />
            <div className="h-1.5 w-1.5 rounded-full bg-black/25" />
          </div>

          <p className="text-sm text-black/40 text-center mb-12">جميع الحقوق محفوظة © Thiqa {new Date().getFullYear()}</p>

          <div className="flex justify-center overflow-hidden">
            <img src={thiqaLogo} alt="Thiqa" className="w-[80%] md:w-[60%] max-w-[700px] opacity-[0.06]" style={{ filter: "invert(1)" }} />
          </div>
        </div>
      </footer>
    </div>
  );
}
