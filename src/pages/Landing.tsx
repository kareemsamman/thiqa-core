import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePageView, trackEvent } from "@/hooks/useAnalyticsTracker";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, ChevronUp, ChevronDown, CheckCircle, Star, ArrowLeft, Play, X, Check,
  Users, FileText, CreditCard, BarChart3, Bell, MessageSquare,
  Phone, Shield, RefreshCcw, Wallet, AlertTriangle, Mail, Clock,
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
// Top marquee — short rotating sales messages. Each one is shown
// full-screen centered in the top bar, swapping every 5 s with a
// gentle fade+slide via CSS. Keep these punchy (under ~55 chars
// each in Arabic) so the animation cycle feels rhythmic — if a
// line is too long the user will never finish reading it before
// the next one swaps in.
const marqueeMessages = [
  "احصل على 35 يوم تجربة مجانية — بدون بطاقة ائتمان",
  "أنشئ حسابك بضغطة واحدة — بدون مكالمات ولا تعقيد",
  "طرق دفع مرنة: شيكات، بطاقات، تقسيط وبوابات دفع متعددة",
  "ألغِ اشتراكك متى شئت — بدون التزامات ولا أسئلة",
  "دعم تقني بالعربية جنبك من اليوم الأول",
];

// "What's new" slider — one card per shipped feature. Cards scroll
// horizontally; each carries its own gradient so the rail feels
// colourful rather than repetitive. Dates are realistic but placeholder
// (the user will tighten them); all fall before 17 Apr 2026 per spec.
const FEATURE_UPDATE_GRADIENTS = [
  "linear-gradient(180deg, #455EBB 0%, #8A96CB 100%)",
  "linear-gradient(180deg, #3B6FBB 0%, #85A9D1 100%)",
  "linear-gradient(180deg, #5A4FBB 0%, #9E95CB 100%)",
  "linear-gradient(180deg, #2E4DB5 0%, #7887C5 100%)",
  "linear-gradient(180deg, #4E62C8 0%, #92A0D8 100%)",
  "linear-gradient(180deg, #3A7BBD 0%, #8BA9CE 100%)",
  "linear-gradient(180deg, #624FBB 0%, #A095CB 100%)",
  "linear-gradient(180deg, #2E5EB5 0%, #7897C5 100%)",
];

const featureUpdates = [
  { version: "v1.4", title: "إصدار وثائق بخطوة واحدة", date: "8 أبريل 2026" },
  { version: "v1.3", title: "بوابات دفع متعددة", date: "22 مارس 2026" },
  { version: "v1.2", title: "تذكيرات SMS ذكية", date: "5 مارس 2026" },
  { version: "v1.1", title: "توقيع العملاء الرقمي", date: "18 فبراير 2026" },
  { version: "v1.0", title: "بلاغات الحوادث والمطالبات", date: "1 فبراير 2026" },
  { version: "v0.9", title: "إدارة السائقين الإضافيين", date: "15 يناير 2026" },
  { version: "v0.8", title: "شيكات متعددة البنوك", date: "28 ديسمبر 2025" },
  { version: "v0.7", title: "سجل نشاطات المستخدمين", date: "10 ديسمبر 2025" },
  { version: "v0.6", title: "تقارير شركات التأمين", date: "22 نوفمبر 2025" },
  { version: "v0.5", title: "ترويسات مخصصة للوكيل", date: "5 نوفمبر 2025" },
  { version: "v0.4", title: "حملات SMS تسويقية", date: "18 أكتوبر 2025", image: "https://thiqacrm.b-cdn.net/Group%201000011509%20(2).png" },
  { version: "v0.3", title: "إيصالات رقمية وطباعة", date: "1 أكتوبر 2025" },
  { version: "v0.2", title: "نظام المهام والمتابعات", date: "15 سبتمبر 2025" },
  { version: "v0.1", title: "نظام التنبيهات المركزي", date: "1 سبتمبر 2025" },
];

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
    desc: "نقدي، شيكات ببنك وفرع، تقسيط داخلي، وبوابات دفع إلكتروني متعددة.",
    tint: "bg-emerald-50 text-emerald-600",
    hoverTint: "group-hover:bg-emerald-100",
    gradient: "linear-gradient(135deg, #ecfdf5 0%, #a7f3d0 100%)",
    accent: "#059669",
    intro: "نظام تحصيل كامل يدعم النقدي، الشيكات، التقسيط الداخلي والدفع ببطاقة الائتمان عبر بوابات إلكترونية مدمجة (Tranzila أو أي بوابة أخرى حسب الطلب) — مع متابعة حالة كل دفعة.",
    bullets: [
      "استلام شيكات مع تسجيل البنك والفرع والتاريخ",
      "تقسيط داخلي مع متابعة المستحقات على العميل",
      "إيصالات نقدية قابلة للطباعة وإرسال SMS",
      "ربط مع بوابات دفع إلكتروني — Tranzila أو غيرها حسب الطلب",
      "تتبع حالة كل دفعة: مكتمل، مرفوض، معلّق",
    ],
    decorBadges: ["شيكات", "بوابات دفع", "تقسيط داخلي"],
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

// Demo-section tabs. Each tab maps directly to a real module inside
// the Thiqa CRM (PolicyWizard / Cheques+Receipts+DebtTracking /
// MarketingSms / FinancialReports / BrokerWallet+CompanySettlement).
// Copy is grounded in the actual shipping features — no marketing
// fluff, no promises the product doesn't keep.
const featureTabs = [
  {
    id: "policies",
    label: "إصدار وتسعير",
    num: "01",
    title: "إصدار وثائق التأمين\nبضغطة واحدة.",
    desc: "معالج ذكي يقودك خطوة بخطوة: اختيار العميل والمركبة، حساب أسعار الإلزامي والثالث والشامل تلقائياً حسب قواعد كل شركة تأمين، وإضافة خدمات الطريق والحوادث في نفس الباقة. الوثيقة جاهزة للتوقيع الرقمي بعد دقائق.",
    gradient: "linear-gradient(180deg, #455EBB 0%, #8A96CB 100%)",
    glow: "radial-gradient(70% 60% at 30% 50%, rgba(255,255,255,0.38) 0%, transparent 60%)",
    image: "https://thiqacrm.b-cdn.net/4.png",
    stats: [
      { value: "3", unit: "دقائق", label: "متوسط الوقت لإصدار وثيقة جديدة — من اختيار العميل إلى الإرسال للتوقيع." },
      { value: "100%", unit: "", label: "دقة في حساب السعر والعمولة حسب قواعد كل شركة تأمين." },
    ],
  },
  {
    id: "payments",
    label: "تحصيل ومالية",
    num: "02",
    title: "تحصيل كامل بدون Excel،\nشيكات بلا عناء.",
    desc: "استلام الشيكات مع تسجيل البنك والفرع والتاريخ، تقسيط داخلي مع متابعة المستحقات على العميل، ربط مع بوابات دفع إلكتروني متعددة (Tranzila أو أي بوابة أخرى حسب الطلب)، وإيصالات نقدية قابلة للطباعة أو الإرسال عبر SMS — كل ذلك في ملف واحد.",
    gradient: "linear-gradient(180deg, #3B6FBB 0%, #85A9D1 100%)",
    glow: "radial-gradient(70% 60% at 72% 45%, rgba(255,255,255,0.38) 0%, transparent 60%)",
    image: "https://thiqacrm.b-cdn.net/image%20215.png",
    stats: [
      { value: "بوابات دفع", unit: "", label: "دفع بالبطاقة عبر Tranzila أو أي بوابة أخرى حسب الطلب — مباشرة من داخل الوثيقة." },
      { value: "65%", unit: "", label: "تقليص في وقت متابعة الديون وتسوية الشيكات بلا Excel يدوي." },
    ],
  },
  {
    id: "sms",
    label: "أتمتة التسويق",
    num: "03",
    title: "النظام يذكّر العميل\nقبل ما تفكر فيه.",
    desc: "تذكيرات تجديد تلقائية قبل شهر وأسبوع من انتهاء الوثيقة، حملات SMS جماعية مع اختيار عملاء ذكي حسب الفرع أو الشركة، نماذج رسائل مخصصة لكل نوع تنبيه، وتتبع كامل لحالة الإرسال مع تقارير DLR.",
    gradient: "linear-gradient(180deg, #5A4FBB 0%, #9E95CB 100%)",
    glow: "radial-gradient(60% 70% at 50% 25%, rgba(255,255,255,0.42) 0%, transparent 60%)",
    image: "https://thiqacrm.b-cdn.net/Group%201000011503%20(1).png",
    stats: [
      { value: "40%", unit: "", label: "ارتفاع في نسبة تجديد الوثائق بفضل التذكيرات التلقائية قبل الانتهاء." },
      { value: "5K+", unit: "", label: "رسائل SMS تُرسل شهرياً — تذكيرات، تسويات، وحملات مستهدفة." },
    ],
  },
  {
    id: "reports",
    label: "تقارير لحظية",
    num: "04",
    title: "كل شيكل مرصود،\nكل فرع تحت السيطرة.",
    desc: "تقارير أرباح مع تفصيل العمولات والمصاريف، رصيد خزينة حيّ مع فصل الدخل عن المصروفات، متابعة الأرصدة المستحقة لكل شركة تأمين، وتقارير متعددة الفروع بالوقت الفعلي — مع تصدير فوري إلى Excel.",
    gradient: "linear-gradient(180deg, #2E4DB5 0%, #7887C5 100%)",
    glow: "radial-gradient(60% 70% at 50% 75%, rgba(255,255,255,0.38) 0%, transparent 60%)",
    image: "https://thiqacrm.b-cdn.net/Group%201000011505.png",
    stats: [
      { value: "لحظياً", unit: "", label: "محرك حسابات الأرباح يُحدَّث مع كل عملية — بدون انتظار نهاية الشهر." },
      { value: "∞", unit: "", label: "تقارير مخصصة حسب الفرع والوسيط والشركة والفترة، قابلة للتصدير." },
    ],
  },
  {
    id: "brokers",
    label: "محفظة الوسطاء",
    num: "05",
    title: "عمولات محسوبة تلقائياً،\nتسويات دقيقة.",
    desc: "حساب العمولات تلقائياً على كل وثيقة، تسويات مع الوسطاء مع تتبع الأرصدة والمستحقات، تسويات مع شركات التأمين بأسعارهم ومدفوعاتهم، وتقارير مفصلة لكل علاقة مالية — بدون جداول إكسل يدوية.",
    gradient: "linear-gradient(180deg, #4E62C8 0%, #92A0D8 100%)",
    glow: "radial-gradient(85% 55% at 50% 50%, rgba(255,255,255,0.34) 0%, transparent 70%)",
    image: "https://thiqacrm.b-cdn.net/Group%201000011506%20(1).png",
    stats: [
      { value: "0", unit: "", label: "عمولات ضائعة — كل شيكل محسوب على صاحبه من لحظة الإصدار." },
      { value: "∞", unit: "", label: "وسطاء وشركات تأمين، كل واحد بمحفظة مالية منفصلة." },
    ],
  },
];

export default function Landing() {
  usePageView("/landing");
  const { data: content } = useLandingContent();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("policies");
  const [slideIdx, setSlideIdx] = useState(0);
  const [sliderInView, setSliderInView] = useState(false);
  // Live-drag state: dragDelta is added to each card's transform while
  // the user is dragging so the rail follows the pointer in real time,
  // then snaps to the nearest slide on release. isDragging disables
  // the CSS transition during drag to keep response instant.
  const [dragDelta, setDragDelta] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef<number | null>(null);
  const dragPausedRef = useRef(false);
  // Slider section — no scroll-trap. The page scrolls normally;
  // the slider just auto-cycles between slides on a timer while the
  // section is anywhere in view. Dramatically simpler (and far less
  // disorienting) than the previous body-lock scroll-jack.
  const sliderSectionRef = useRef<HTMLElement | null>(null);
  // "Grow with Thiqa" accordion — first item open by default.
  const [growAccordionIdx, setGrowAccordionIdx] = useState<number>(0);
  useEffect(() => {
    const section = sliderSectionRef.current;
    if (!section) return;
    const SLIDES = 5;
    let inView = false;
    let intervalId: number | null = null;
    const start = () => {
      if (intervalId !== null) return;
      intervalId = window.setInterval(() => {
        if (dragPausedRef.current) return;
        setSlideIdx((prev) => (prev + 1) % SLIDES);
      }, 4500);
    };
    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          inView = e.isIntersecting;
          if (inView) {
            setSliderInView(true);
            start();
          } else {
            stop();
          }
        }
      },
      { threshold: 0.15 },
    );
    io.observe(section);
    return () => {
      io.disconnect();
      stop();
    };
  }, []);
  const [testimonialIdx, setTestimonialIdx] = useState(0);
  const [testimonialAnim, setTestimonialAnim] = useState<"in" | "out">("in");
  // Testimonials auto-play: when the section is in view, cycle every
  // 6s with an infinite loop. Manual arrow/dot clicks reset the timer
  // so the user always sees the clicked slide for the full interval.
  const testimonialsSectionRef = useRef<HTMLElement | null>(null);
  const testimonialTickRef = useRef(0);
  useEffect(() => {
    const section = testimonialsSectionRef.current;
    if (!section) return;
    const COUNT = 3;
    let intervalId: number | null = null;
    const start = () => {
      if (intervalId !== null) return;
      intervalId = window.setInterval(() => {
        // Cross-fade via the same anim state the arrows use.
        setTestimonialAnim("out");
        const tick = ++testimonialTickRef.current;
        window.setTimeout(() => {
          if (tick !== testimonialTickRef.current) return;
          setTestimonialIdx((p) => (p + 1) % COUNT);
          setTestimonialAnim("in");
        }, 350);
      }, 6000);
    };
    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) start(); else stop();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(section);
    return () => {
      io.disconnect();
      stop();
    };
  }, []);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
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
  // Scroll-linked chrome — binary state + *instant* scroll snap.
  //
  // Two moving parts, working together:
  //   1. `scrolled` flips once at y > 8 and drives two stable visual
  //      states (open / pill) via conditional inline styles + a
  //      short CSS transition on the elements themselves.
  //   2. The scroll listener additionally TELEPORTS the window past
  //      the 0→DEAD_ZONE_END range the instant the user crosses
  //      into it — scrolling up jumps to 0, scrolling down jumps to
  //      DEAD_ZONE_END + 12. `behavior: "auto"` (not smooth) so the
  //      user literally never sees an in-between scroll position.
  //
  // Together: no per-frame JS, no interpolation, no half-morph
  // frames, and no way to park inside the dead zone. The nav you
  // see is always either fully-open or fully-pill.
  useEffect(() => {
    const DEAD_ZONE_END = 158;
    let prevY = window.scrollY;
    let lastScrolled = prevY > 8;
    setScrolled(lastScrolled);
    let snapping = false;

    const onScroll = () => {
      if (snapping) return;
      const y = window.scrollY;
      const dir: "up" | "down" = y > prevY ? "down" : "up";

      if (y > 0 && y < DEAD_ZONE_END) {
        snapping = true;
        const target = dir === "up" ? 0 : DEAD_ZONE_END + 12;
        window.scrollTo({ top: target, behavior: "auto" });
        requestAnimationFrame(() => {
          prevY = window.scrollY;
          const next = prevY > 8;
          if (next !== lastScrolled) {
            lastScrolled = next;
            setScrolled(next);
          }
          snapping = false;
        });
        return;
      }

      prevY = y;
      const next = y > 8;
      if (next !== lastScrolled) {
        lastScrolled = next;
        setScrolled(next);
      }
    };

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

  // Top marquee — auto-cycling centered sales message. The old
  // horizontally scrolling icon list has been replaced by a single
  // centered line of copy that swaps every 5 s with a gentle fade +
  // vertical glide. The animation duration matches the interval,
  // so by the time the <span> is remounted (via `key`) the previous
  // one has already faded to opacity 0 and the swap is invisible.
  const [marqueeIdx, setMarqueeIdx] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => {
      setMarqueeIdx((i) => (i + 1) % marqueeMessages.length);
    }, 5000);
    return () => window.clearInterval(interval);
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
    testimonialTickRef.current++;
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

      {/* ═══ Top marquee — centered rotating sales messages ═══
          Single centered line of copy that swaps every 5 s. The
          fade+glide animation lives in the <style> block right below,
          and the `key={marqueeIdx}` on the inner <span> is what
          re-mounts it on every tick so the keyframes re-play.
          Binary open/closed state preserved from the old marquee —
          it still collapses when the user scrolls past the 8 px
          threshold (same `scrolled` boolean). */}
      <style>{`
        @keyframes mqcCycle {
          0%   { opacity: 0; transform: translateY(-10px); filter: blur(2px); }
          18%  { opacity: 1; transform: translateY(0);     filter: blur(0); }
          82%  { opacity: 1; transform: translateY(0);     filter: blur(0); }
          100% { opacity: 0; transform: translateY(10px);  filter: blur(2px); }
        }
        .mqc-text {
          display: inline-block;
          animation: mqcCycle 5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
      `}</style>
      <div
        dir="rtl"
        className="relative bg-white overflow-hidden transform-gpu origin-top"
        style={{
          maxHeight: scrolled ? 0 : 56,
          paddingTop: scrolled ? 0 : 12,
          paddingBottom: scrolled ? 0 : 12,
          opacity: scrolled ? 0 : 1,
          transform: scrolled ? "translate3d(0, -60px, 0)" : "translate3d(0, 0, 0)",
          pointerEvents: scrolled ? "none" : "auto",
          transitionProperty: "max-height, padding, opacity, transform",
          transitionDuration: "280ms",
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        aria-label="رسائل ترويجية"
        aria-hidden={scrolled}
      >
        <div
          className="flex items-center justify-center px-6 h-full"
          aria-live="polite"
          aria-atomic="true"
        >
          <span
            key={marqueeIdx}
            className="mqc-text text-[13px] md:text-[14px] font-medium text-black/75 tracking-tight"
          >
            {marqueeMessages[marqueeIdx]}
          </span>
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
          className="pointer-events-auto flex items-center px-6 h-14 md:h-16 mx-auto transform-gpu"
          style={{
            // Nav width stays pinned at 75% across both states. Only
            // the pill chrome (margin, radius, blur, bg, shadow)
            // swaps when `scrolled` flips at y > 8 — colors and logo
            // are now black at all times per the new design.
            width: "75%",
            maxWidth: "72rem",
            marginTop: scrolled ? "12px" : "0px",
            borderRadius: scrolled ? "9999px" : "0px",
            transform: scrolled ? "translate3d(0, 0, 0)" : "translate3d(0, 44px, 0)",
            backdropFilter: scrolled ? "blur(8px)" : "none",
            WebkitBackdropFilter: scrolled ? "blur(8px)" : "none",
            backgroundColor: scrolled ? "rgba(255, 255, 255, 0.8)" : "rgba(255, 255, 255, 0)",
            boxShadow: scrolled ? "0 1px 20px 0 rgba(0, 0, 0, 0.12)" : "none",
            border: "none",
            transitionProperty: "margin-top, border-radius, transform, backdrop-filter, background-color, box-shadow",
            transitionDuration: "280ms",
            transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {/* Three-zone layout with `flex-1` outer columns — guarantees
              the menu sits in the true visual center of the bar
              regardless of how wide the logo or CTA cluster are. */}

          {/* Logo (right side under RTL because it's the first child).
              Always black: icon source and wordmark color do not
              swap on scroll anymore. */}
          <div className="flex-1 flex justify-start">
            <div className="flex items-center text-black">
              <ThiqaLogoAnimation
                iconSize={32}
                interactive={false}
                iconSrc="https://thiqacrm.b-cdn.net/small_black.png"
              />
            </div>
          </div>

          {/* Menu — centered. */}
          <div className="hidden md:flex items-center gap-10 text-[14px] font-medium text-black/75">
            {false && <a href="#features" className="transition-colors hover:text-black">لماذا نحن مختلفون</a>}
            <a href="#demo" className="transition-colors hover:text-black">كيف يعمل</a>
            <a href="#faq" className="transition-colors hover:text-black">أسئلة وأجوبة</a>
            <a href="/pricing" className="transition-colors hover:text-black">الأسعار</a>
          </div>

          {/* CTA cluster (left side under RTL because it's the last
              child). Always black text and dark ring on the signup
              pill. */}
          <div className="flex-1 flex justify-end items-center gap-3 md:gap-5">
            <button
              onClick={() => navigate("/login")}
              className="text-[14px] font-semibold text-black/80 hover:text-black transition-colors hidden sm:inline-flex items-center"
            >
              {ct(content, "navbar_login", "تسجيل الدخول")}
            </button>

            <button
              onClick={() => { trackEvent("signup_click", "/landing"); navigate("/login?view=signup"); }}
              className="px-8 py-3 text-[14px] font-bold text-black hover:bg-black/5 transition-all"
              style={{
                borderRadius: "100px",
                border: "2px solid rgba(0, 0, 0, 0.22)",
                background: "rgba(255, 255, 255, 0.0)",
                boxShadow: "0 2px 8px 0 rgba(0, 0, 0, 0.06)",
              }}
            >
              {ct(content, "navbar_cta", "احصل على 35 يوم مجاناً")}
            </button>
          </div>
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

      {/* ═══ Section: Story / Social-proof ═══
          Sits between the hero and the 6-tile feature grid. Layout:
          centered hero image (placeholder — swap the inner div for an
          <img> when the artwork lands) flanked by four floating cards
          (chat bubble with typing-in message, PDF file card, apps
          integration card, phone-call notification). The headline
          above uses a staggered RTL typewriter reveal across four
          segments — same clip-path + steps() technique as section 2,
          sequenced so each segment finishes before the next starts.
          After the headline finishes, the chat bubble message types
          in last to complete the "live conversation" vibe.
          IntersectionObserver toggles `.hs-visible` once on first
          entry so everything animates together. */}
      <style>{`
        @keyframes hsTypeRtl {
          from { clip-path: inset(0 0 0 100%); }
          to   { clip-path: inset(0 0 0 0); }
        }
        @keyframes hsFromLeft {
          0%   { opacity: 0; transform: translate3d(-80px, 14px, 0) scale(0.72) rotate(-6deg); }
          60%  { opacity: 1; }
          100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1) rotate(0deg); }
        }
        @keyframes hsFromRight {
          0%   { opacity: 0; transform: translate3d(80px, 14px, 0) scale(0.72) rotate(6deg); }
          60%  { opacity: 1; }
          100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1) rotate(0deg); }
        }
        @keyframes hsFloat {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        @keyframes hsImgIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .hs-type {
          display: inline-block;
          clip-path: inset(0 0 0 100%);
        }
        .hs-visible .hs-type-1 { animation: hsTypeRtl 1.0s steps(24, end) 0.15s forwards; }
        .hs-visible .hs-type-2 { animation: hsTypeRtl 0.7s steps(14, end) 1.30s forwards; }

        /* Full-width hero image fades in once the section becomes
           visible. Sits absolutely behind the headline + pill layer. */
        .hs-img {
          opacity: 0;
        }
        .hs-visible .hs-img {
          animation: hsImgIn 1.0s cubic-bezier(0.22, 1, 0.36, 1) 0.2s forwards;
        }

        /* Each pill card slides in from its own side, scale-bouncing
           softly into place. Staggered delays give a "popping in one
           at a time" cadence — the image lands first, then the cards
           pile in around it. */
        .hs-pill {
          opacity: 0;
          will-change: transform, opacity;
        }
        .hs-pill-l { transform: translate3d(-80px, 14px, 0) scale(0.72) rotate(-6deg); }
        .hs-pill-r { transform: translate3d(80px, 14px, 0)  scale(0.72) rotate(6deg); }
        .hs-visible .hs-pill-l {
          animation:
            hsFromLeft 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
            hsFloat 5s ease-in-out 1.2s infinite;
        }
        .hs-visible .hs-pill-r {
          animation:
            hsFromRight 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
            hsFloat 5s ease-in-out 1.2s infinite;
        }
        .hs-visible .hs-d-1  { animation-delay: 0.85s; }
        .hs-visible .hs-d-2  { animation-delay: 1.00s; }
        .hs-visible .hs-d-3  { animation-delay: 1.15s; }
        .hs-visible .hs-d-4  { animation-delay: 1.30s; }
        .hs-visible .hs-d-5  { animation-delay: 1.45s; }
        .hs-visible .hs-d-6  { animation-delay: 1.60s; }
        .hs-visible .hs-d-7  { animation-delay: 1.75s; }
        .hs-visible .hs-d-8  { animation-delay: 1.90s; }
        .hs-visible .hs-d-9  { animation-delay: 2.10s; }
        .hs-visible .hs-d-10 { animation-delay: 2.25s; }
        .hs-visible .hs-d-11 { animation-delay: 2.40s; }
        .hs-visible .hs-d-12 { animation-delay: 2.55s; }
        .hs-visible .hs-d-13 { animation-delay: 2.70s; }
        .hs-visible .hs-d-14 { animation-delay: 2.85s; }

        /* Depth-of-field pills — out-of-focus sibling cards that
           sit further in the "distance". Slight opacity drop +
           physical blur filter sells the layered depth. */
        .hs-pill-blur {
          filter: blur(3px);
          opacity: 0.55;
        }

        .hs-highlight {
          background: #122042;
          color: #ffffff;
          padding: 0 0.28em;
          border-radius: 6px;
        }
      `}</style>
      <section
        ref={(el) => {
          if (!el) return;
          if ((el as HTMLElement & { __hsBound?: boolean }).__hsBound) return;
          (el as HTMLElement & { __hsBound?: boolean }).__hsBound = true;
          const io = new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                if (e.isIntersecting) {
                  e.target.classList.add("hs-visible");
                  io.disconnect();
                  break;
                }
              }
            },
            { threshold: 0.15 },
          );
          io.observe(el);
        }}
        className="relative w-full min-h-screen overflow-hidden bg-white"
      >
        {/* Sharp foreground image — 70% viewport width, 76% section
            height, anchored to the bottom so the person's head sits
            in the upper portion of the image (around ~25-45% of the
            section) and the pills can crowd around it. */}
        <img
          src="https://thiqacrm.b-cdn.net/hf_20260416_191720_99f2169b-05a1-45de-9063-68dd989588c1%201%20(2)%20(1).jpg"
          alt="وكيل تأمين غارق بالمهام قبل Thiqa"
          className="hs-img absolute bottom-0 left-1/2 -translate-x-1/2 w-[70%] h-[76%] object-cover object-bottom"
          loading="lazy"
        />

        {/* Headline — two stacked lines, both black. The lead-in is
            font-light (300) and the punchline is font-bold (700) so
            the weight contrast carries the emphasis instead of a
            color shift. Both type in right-to-left via clip-path +
            steps(), the bold line starting after the light one
            finishes so the reveal reads as a natural sentence. */}
        <h2 className="relative z-10 flex flex-col justify-center items-center text-center leading-[1.25] md:leading-[1.2] pt-20 md:pt-24 px-6 text-black">
          <span className="hs-type hs-type-1 block font-light text-[1.5rem] md:text-[2.25rem]">
            زهقت من الأكسل والأوراق؟
          </span>
          <span className="hs-type hs-type-2 block font-bold mt-3 text-[2.5rem] md:text-[4rem] leading-[1.1]">
            ثقة هو الحل.
          </span>
        </h2>

        {/* Pill notifications — glassmorphism cards concentrated in
            the upper half of the section with percentage-based
            positioning. Each pill is translucent white with a light
            backdrop blur and a bright border so it reads as frosted
            glass over the blurred backdrop. Spring-bounce entry
            (hsFromLeft / hsFromRight) + gentle continuous float
            (hsFloat). Hidden below md breakpoint. */}
        <div className="absolute inset-0 z-20 pointer-events-none">
          {/* Left pills — solid cream style matching the baked-in
              cards in the hero image. Icon floats directly on the
              pill surface (no inner white circle). Moved closer to
              the person (13-18% from edge instead of 2-8%) so they
              hug the head/shoulder area. */}
          <div className="hs-pill hs-pill-l hs-d-1 hidden md:flex absolute top-[22%] left-[13%] lg:left-[16%] items-center gap-2.5 rounded-full bg-[#faf5ef] border border-black/[0.04] px-4 py-2.5 shadow-[0_8px_24px_-6px_rgba(18,32,66,0.12)]">
            <AlertTriangle className="h-4 w-4 text-rose-500 flex-shrink-0" strokeWidth={2.4} />
            <span className="text-[13px] font-semibold text-black whitespace-nowrap">عاجل</span>
          </div>

          <div className="hs-pill hs-pill-l hs-d-3 hidden md:flex absolute top-[30%] left-[11%] lg:left-[13%] items-center gap-2.5 rounded-full bg-[#faf5ef] border border-black/[0.04] px-4 py-2.5 shadow-[0_8px_24px_-6px_rgba(18,32,66,0.12)]">
            <Phone className="h-4 w-4 text-[#122042] flex-shrink-0" strokeWidth={2.2} />
            <span className="text-[13px] font-semibold text-black whitespace-nowrap">مكالمة فائتة</span>
            <span className="flex-shrink-0 h-5 min-w-[22px] px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
              7
            </span>
          </div>

          <div className="hs-pill hs-pill-l hs-d-5 hidden md:flex absolute top-[38%] left-[14%] lg:left-[17%] items-center gap-2.5 rounded-full bg-[#faf5ef] border border-black/[0.04] px-4 py-2.5 shadow-[0_8px_24px_-6px_rgba(18,32,66,0.12)]">
            <MessageSquare className="h-4 w-4 text-rose-500 flex-shrink-0" strokeWidth={2.2} />
            <span className="text-[13px] font-semibold text-black whitespace-nowrap">شكوى عميل</span>
          </div>

          <div className="hs-pill hs-pill-l hs-d-7 hidden md:flex absolute top-[46%] left-[12%] lg:left-[15%] items-center gap-2.5 rounded-full bg-[#faf5ef] border border-black/[0.04] px-4 py-2.5 shadow-[0_8px_24px_-6px_rgba(18,32,66,0.12)]">
            <BarChart3 className="h-4 w-4 text-amber-600 flex-shrink-0" strokeWidth={2.2} />
            <span className="text-[13px] font-semibold text-black whitespace-nowrap">خطأ في الجدول</span>
          </div>

          {/* Right pills */}
          <div className="hs-pill hs-pill-r hs-d-2 hidden md:flex absolute top-[22%] right-[13%] lg:right-[16%] items-center gap-2.5 rounded-full bg-[#faf5ef] border border-black/[0.04] px-4 py-2.5 shadow-[0_8px_24px_-6px_rgba(18,32,66,0.12)]">
            <Mail className="h-4 w-4 text-[#122042] flex-shrink-0" strokeWidth={2.2} />
            <span className="text-[13px] font-semibold text-black whitespace-nowrap">بريد غير مقروء</span>
            <span className="flex-shrink-0 h-5 min-w-[22px] px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
              23
            </span>
          </div>

          <div className="hs-pill hs-pill-r hs-d-4 hidden md:flex absolute top-[30%] right-[11%] lg:right-[13%] items-center gap-2.5 rounded-full bg-[#faf5ef] border border-black/[0.04] px-4 py-2.5 shadow-[0_8px_24px_-6px_rgba(18,32,66,0.12)]">
            <Clock className="h-4 w-4 text-rose-500 flex-shrink-0" strokeWidth={2.2} />
            <span className="text-[13px] font-semibold text-black whitespace-nowrap">تجديد متأخر</span>
          </div>

          <div className="hs-pill hs-pill-r hs-d-6 hidden md:flex absolute top-[38%] right-[14%] lg:right-[17%] items-center gap-2.5 rounded-full bg-[#faf5ef] border border-black/[0.04] px-4 py-2.5 shadow-[0_8px_24px_-6px_rgba(18,32,66,0.12)]">
            <Bell className="h-4 w-4 text-amber-600 flex-shrink-0" strokeWidth={2.2} />
            <span className="text-[13px] font-semibold text-black whitespace-nowrap">مواعيد متراكمة</span>
          </div>

          <div className="hs-pill hs-pill-r hs-d-8 hidden md:flex absolute top-[46%] right-[12%] lg:right-[15%] items-center gap-2.5 rounded-full bg-[#faf5ef] border border-black/[0.04] px-4 py-2.5 shadow-[0_8px_24px_-6px_rgba(18,32,66,0.12)]">
            <FileText className="h-4 w-4 text-[#7a5a36] flex-shrink-0" strokeWidth={2.2} />
            <span className="text-[13px] font-semibold text-black whitespace-nowrap">ملف PDF</span>
          </div>

          {/* ── Bigger glass pills on the outer edges ──
              Same DOM container but styled as larger frosted-glass
              cards with padding, text and icon all bumped up. They
              enter after the cream pills land (delays 2.1-2.55s) and
              live at scattered, non-aligned positions near the
              corners so the composition feels dispersed instead of
              gridded. */}
          <div className="hs-pill hs-pill-l hs-d-9 hidden md:flex absolute top-[8%] left-[2%] lg:left-[3%] items-center gap-3 rounded-full bg-white/35 backdrop-blur-xl backdrop-saturate-150 border border-white/70 px-5 py-3.5 shadow-[0_14px_40px_-8px_rgba(18,32,66,0.22)]">
            <MessageSquare className="h-5 w-5 text-[#122042] flex-shrink-0" strokeWidth={2} />
            <span className="text-[14px] font-semibold text-black whitespace-nowrap">استعلام جديد</span>
            <span className="flex-shrink-0 h-2.5 w-2.5 rounded-full bg-rose-500" />
          </div>

          <div className="hs-pill hs-pill-r hs-d-10 hidden md:flex absolute top-[13%] right-[2%] lg:right-[2%] items-center gap-3 rounded-full bg-white/35 backdrop-blur-xl backdrop-saturate-150 border border-white/70 px-5 py-3.5 shadow-[0_14px_40px_-8px_rgba(18,32,66,0.22)]">
            <AlertTriangle className="h-5 w-5 text-rose-500 flex-shrink-0" strokeWidth={2.2} />
            <span className="text-[14px] font-semibold text-black whitespace-nowrap">وثيقة منتهية</span>
          </div>

          <div className="hs-pill hs-pill-l hs-d-11 hidden md:flex absolute top-[60%] left-[2%] lg:left-[2%] items-center gap-3 rounded-full bg-white/35 backdrop-blur-xl backdrop-saturate-150 border border-white/70 px-5 py-3.5 shadow-[0_14px_40px_-8px_rgba(18,32,66,0.22)]">
            <Wallet className="h-5 w-5 text-amber-600 flex-shrink-0" strokeWidth={2} />
            <span className="text-[14px] font-semibold text-black whitespace-nowrap">دفعة متأخرة</span>
            <span className="flex-shrink-0 h-6 min-w-[26px] px-2 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center">
              3
            </span>
          </div>

          <div className="hs-pill hs-pill-r hs-d-12 hidden md:flex absolute top-[65%] right-[2%] lg:right-[3%] items-center gap-3 rounded-full bg-white/35 backdrop-blur-xl backdrop-saturate-150 border border-white/70 px-5 py-3.5 shadow-[0_14px_40px_-8px_rgba(18,32,66,0.22)]">
            <CreditCard className="h-5 w-5 text-[#122042] flex-shrink-0" strokeWidth={2} />
            <span className="text-[14px] font-semibold text-black whitespace-nowrap">تحصيل مطلوب</span>
          </div>

          {/* Depth-of-field cards — blurred/faded siblings further in
              the background. Same cream pill design but with the
              .hs-pill-blur filter class, placed at "between" spots
              not covered by the sharp pills so they fill negative
              space and add depth without competing for attention. */}
          <div className="hs-pill hs-pill-blur hs-pill-l hs-d-13 hidden md:flex absolute top-[6%] left-[22%] items-center gap-2.5 rounded-full bg-[#faf5ef] border border-black/[0.04] px-4 py-2.5 shadow-[0_8px_24px_-6px_rgba(18,32,66,0.1)]">
            <Bell className="h-4 w-4 text-[#122042] flex-shrink-0" strokeWidth={2.2} />
            <span className="text-[13px] font-semibold text-black whitespace-nowrap">رسالة جديدة</span>
          </div>

          <div className="hs-pill hs-pill-blur hs-pill-r hs-d-14 hidden md:flex absolute top-[74%] right-[20%] items-center gap-2.5 rounded-full bg-[#faf5ef] border border-black/[0.04] px-4 py-2.5 shadow-[0_8px_24px_-6px_rgba(18,32,66,0.1)]">
            <Clock className="h-4 w-4 text-amber-600 flex-shrink-0" strokeWidth={2.2} />
            <span className="text-[13px] font-semibold text-black whitespace-nowrap">طلب معلق</span>
          </div>
        </div>
      </section>

      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ Section 3: Demo / Feature tabs ═══
          Moved up from its old position (was below the 6-tile grid)
          so the landing reads: hero → overwhelmed story → demo of
          the fix → feature tiles. Dark-theme redesign inspired by
          the Hebrew reference: a big black card split into a mockup
          visual on the left (with atmospheric blurred backdrop + a
          navy radial glow behind the device shot) and a dark
          description/CTA card on the right. Two black stat cards
          below mirror the reference's "+216% + small cards" row,
          each with its own corner glow so the dark surface doesn't
          read as flat. Tabs stay light on top for contrast. */}
      <style>{`
        @keyframes dhTypeRtl {
          from { clip-path: inset(0 0 0 100%); }
          to   { clip-path: inset(0 0 0 0); }
        }
        @keyframes dhFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .dh-type {
          display: inline-block;
          clip-path: inset(0 0 0 100%);
        }
        .dh-fade { opacity: 0; }
        .dh-visible .dh-type-1 { animation: dhTypeRtl 0.8s steps(16, end) 0.15s forwards; }
        .dh-visible .dh-type-2 { animation: dhTypeRtl 1.4s steps(36, end) 0.95s forwards; }
        .dh-visible .dh-fade   { animation: dhFadeIn 0.7s cubic-bezier(0.22,1,0.36,1) 2.30s forwards; }
      `}</style>
      <section
        id="demo"
        ref={(el) => {
          if (!el) return;
          if ((el as HTMLElement & { __dhBound?: boolean }).__dhBound) return;
          (el as HTMLElement & { __dhBound?: boolean }).__dhBound = true;
          const io = new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                if (e.isIntersecting) {
                  e.target.classList.add("dh-visible");
                  io.disconnect();
                  break;
                }
              }
            },
            { threshold: 0.15 },
          );
          io.observe(el);
        }}
        className="py-20 md:py-28 relative bg-white"
      >
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12 md:mb-16">
            <p className="text-base md:text-lg text-black mb-4 tracking-wide font-light">
              <span className="dh-type dh-type-1">
                {ct(content, "showcase_label", "لماذا ثقة بالذات؟")}
              </span>
            </p>
            <h2 className="text-[2.25rem] md:text-[3.5rem] font-bold leading-[1.15] md:leading-[1.1] mb-5 text-black">
              <span className="dh-type dh-type-2">
                {ct(content, "showcase_title", "كل الأدوات لإدارة الوكالة تحت سقف واحد")}
              </span>
            </h2>
            <p className="dh-fade text-base md:text-lg text-black/55 max-w-2xl mx-auto leading-relaxed">
              {ct(content, "showcase_subtitle", "بنية تقنية متقدمة توفر لك الوقت، تمنع الأخطاء وتزيد الربحية.")}
            </p>
          </div>

          {/* Tabs — light bar for contrast against the dark content
              below. Active tab grows an animated underline bar at the
              bottom edge so the click has a visible accent anchor. */}
          <div className="flex overflow-x-auto border border-black/[0.08] rounded-xl mb-4 bg-white">
            {featureTabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex-1 min-w-[140px] px-4 py-4 text-center border-l border-black/[0.08] first:border-l-0 transition-all duration-300 ${
                    active
                      ? "bg-black/[0.04] text-black"
                      : "text-black/50 hover:text-black/75 hover:bg-black/[0.02]"
                  }`}
                >
                  <span className={`text-xs block mb-1 transition-colors duration-300 ${active ? "text-black/70" : "text-black/40"}`}>
                    {tab.num}
                  </span>
                  <span className="text-sm font-semibold">{tab.label}</span>
                  <span
                    className="absolute left-3 right-3 bottom-0 h-[2px] rounded-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] origin-center"
                    style={{
                      background: "linear-gradient(90deg, #122042 0%, #4a6cc7 100%)",
                      transform: active ? "scaleX(1)" : "scaleX(0)",
                    }}
                  />
                </button>
              );
            })}
          </div>

          {/* Tab content. Each tab carries its own `gradient` + `glow`
              so switching tabs paints the three cards in a
              different colour mood. `key={tab.id}` forces a remount
              on change so the staggered card-enter animations replay
              on every tab click. The animations are also gated by
              `.dh-visible` (set by the section's IntersectionObserver
              above) so the first reveal runs only once the user has
              actually scrolled the section into view. */}
          <style>{`
            @keyframes demoInFromRight {
              from { opacity: 0; transform: translate3d(60px, 12px, 0) scale(0.95); }
              to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
            }
            @keyframes demoInFromLeft {
              from { opacity: 0; transform: translate3d(-60px, 12px, 0) scale(0.95); }
              to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
            }
            @keyframes demoInUp {
              from { opacity: 0; transform: translate3d(0, 34px, 0) scale(0.96); }
              to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
            }
            .demo-card { opacity: 0; will-change: transform, opacity; }
            .dh-visible .demo-card-mockup {
              animation: demoInFromRight 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.05s both;
            }
            .dh-visible .demo-card-desc {
              animation: demoInFromLeft 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.2s both;
            }
            .dh-visible .demo-card-stat-1 {
              animation: demoInUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.38s both;
            }
            .dh-visible .demo-card-stat-2 {
              animation: demoInUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.5s both;
            }
          `}</style>
          {featureTabs.filter(t => t.id === activeTab).map(tab => (
            <div key={tab.id} className="space-y-4">
              {/* Main row: mockup card + description card */}
              <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
                {/* Left: Mockup card with per-tab gradient + glow */}
                <div
                  className="demo-card demo-card-mockup relative rounded-3xl overflow-hidden min-h-[320px] md:min-h-[380px] lg:min-h-[440px] flex items-center justify-center p-6 md:p-10"
                  style={{ background: tab.gradient }}
                >
                  <div
                    className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage: `url(${tab.image ?? featuresMockup})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      filter: "blur(60px) saturate(1.1)",
                      transform: "scale(1.3)",
                    }}
                    aria-hidden="true"
                  />
                  <div
                    className="absolute inset-0"
                    style={{ background: tab.glow }}
                    aria-hidden="true"
                  />
                  <img
                    src={tab.image ?? featuresMockup}
                    alt=""
                    className="relative z-10 w-full max-w-[88%] h-auto rounded-xl shadow-[0_30px_80px_-10px_rgba(18,32,66,0.45)]"
                    loading="lazy"
                  />
                </div>

                {/* Right: Description card — same per-tab gradient */}
                <div
                  className="demo-card demo-card-desc relative rounded-3xl overflow-hidden p-8 lg:p-10 flex flex-col justify-between min-h-[320px] lg:min-h-[440px]"
                  style={{ background: tab.gradient }}
                >
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: tab.glow }}
                    aria-hidden="true"
                  />
                  <div className="relative z-10">
                    <span className="inline-flex text-[11px] text-white/70 font-bold tracking-[0.2em] mb-4 uppercase">
                      {tab.num} · {tab.label}
                    </span>
                    <h3 className="text-2xl lg:text-[1.9rem] font-bold leading-tight whitespace-pre-line mb-4 text-white">
                      {tab.title}
                    </h3>
                    <p className="text-white/85 text-sm leading-relaxed">
                      {tab.desc}
                    </p>
                  </div>
                  <button
                    onClick={() => navigate("/login?view=signup")}
                    className="relative z-10 mt-8 self-start flex items-center gap-2 px-6 py-3 text-sm font-bold text-white rounded-full bg-white/20 border border-white/40 hover:bg-white/30 transition-colors backdrop-blur-sm"
                  >
                    ابدأ التجربة الآن
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Bottom row: 2 stat cards — same per-tab gradient */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {tab.stats.map((stat, j) => (
                  <div
                    key={j}
                    className={`demo-card demo-card-stat-${j + 1} relative rounded-3xl overflow-hidden p-6 lg:p-8 text-white`}
                    style={{ background: tab.gradient }}
                  >
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ background: tab.glow }}
                      aria-hidden="true"
                    />
                    <div className="relative z-10">
                      <div className="text-4xl lg:text-5xl font-extrabold leading-none">
                        {stat.value}
                        <span className="text-xl lg:text-2xl font-medium text-white/70 mr-1">{stat.unit}</span>
                      </div>
                      <p className="text-xs lg:text-sm text-white/80 mt-3 leading-relaxed">{stat.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ Section 2: What's new (feature updates) ═══
          Full-width horizontal rail of release cards. Each card has
          its own blurred gradient so the rail reads as a colourful
          changelog. Autoplay (see the updates useEffect) advances
          the rail every 3.5s and loops; hovering the rail pauses it.
          An IntersectionObserver flips `.fb-visible` on first
          viewport entry so the title typewrites and cards slide in
          with a staggered scale-up. */}
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

        /* Inner blurred gradient layer — extended beyond the card's
           edges so the gaussian blur doesn't reveal transparent
           corners inside the rounded frame. */
        .updates-bg-blur {
          position: absolute;
          inset: -24px;
          filter: blur(28px) saturate(1.1);
          will-change: filter;
        }
        /* Infinite marquee. The rail renders the card set twice
           in the DOM, then translates from 0 → −50% in a continuous
           linear loop. Because the two halves are identical,
           resetting to 0 at the end is visually seamless. */
        .updates-marquee {
          width: max-content;
          animation: updatesMarquee 80s linear infinite;
          will-change: transform;
        }
        @keyframes updatesMarquee {
          from { transform: translate3d(0, 0, 0); }
          to   { transform: translate3d(-50%, 0, 0); }
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
        className="py-20 md:py-28 bg-white overflow-hidden"
      >
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12 md:mb-14">
            <p className="text-sm mb-3 tracking-wide font-light text-black/70">
              <span className="fb-type fb-type-label">ما الجديد</span>
            </p>
            <h2 className="text-[2rem] md:text-[2.6rem] font-bold leading-tight text-black">
              <span className="fb-type fb-type-title">نحن لا نتوقف عن التطوير</span>
            </h2>
          </div>
        </div>

        {/* Full-width marquee rail. The outer div clips overflow;
            the inner .updates-marquee translates leftward forever.
            The card list is rendered twice so the loop seam is
            invisible — at the end of set 1, set 2 is already
            perfectly in place. Motion is right → left (new cards
            appear from the right edge). */}
        <div className="overflow-hidden" dir="ltr">
          <div className="updates-marquee flex gap-5 md:gap-6">
            {[...featureUpdates, ...featureUpdates].map((u, i) => (
              <div
                key={i}
                className="flex-shrink-0 w-[260px] md:w-[320px]"
                aria-hidden={i >= featureUpdates.length ? "true" : undefined}
              >
                <div className="relative aspect-[8/9] rounded-[28px] overflow-hidden p-6 md:p-8 flex items-center justify-center">
                  <div
                    className="updates-bg-blur"
                    style={{ background: FEATURE_UPDATE_GRADIENTS[i % FEATURE_UPDATE_GRADIENTS.length] }}
                    aria-hidden="true"
                  />
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background:
                        "radial-gradient(60% 50% at 50% 25%, rgba(255,255,255,0.40) 0%, transparent 65%)",
                    }}
                    aria-hidden="true"
                  />
                  <img
                    src={("image" in u && u.image) ? u.image : featuresMockup}
                    alt=""
                    className="relative max-w-full max-h-full object-contain rounded-2xl shadow-[0_24px_50px_-12px_rgba(10,15,35,0.45)]"
                    loading="lazy"
                  />
                </div>
                <div className="pt-5 px-1 text-right" dir="rtl">
                  <p className="text-[12px] font-light tracking-[0.18em] uppercase text-black/70">
                    {u.version}
                  </p>
                  <h3 className="text-[16px] md:text-[17px] font-bold text-black mt-2 leading-snug">
                    {u.title}
                  </h3>
                  <p className="text-[12px] text-black/45 mt-1.5">
                    {u.date}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Signup CTA — sits centred below the rail so the section
            closes with a clear next-step for the user. */}
        <div className="max-w-6xl mx-auto px-6 mt-10 md:mt-12 text-center">
          <button
            type="button"
            onClick={() => navigate("/login?view=signup")}
            className="px-8 py-3 text-[14px] font-bold text-white hover:opacity-90 transition-opacity"
            style={{
              borderRadius: "100px",
              background: "#111",
              boxShadow: "0 4px 16px 0 rgba(0, 0, 0, 0.12)",
            }}
          >
            {ct(content, "hero_cta", "احصل على 35 يوم مجاناً")}
          </button>
        </div>
      </section>

      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ Section 2b: Grow with Thiqa (accordion + image) ═══
          Split layout — left column has the section heading, a
          3-item accordion, and a signup CTA; right column is a
          product mockup tile. First accordion item is open by
          default; the rest expand on click. IntersectionObserver
          flips `.gr-vis` on first view so the text column slides in
          from the left and the image tile from the right. */}
      <style>{`
        @keyframes grInLeft {
          from { opacity: 0; transform: translate3d(-40px, 0, 0); }
          to   { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @keyframes grInRight {
          from { opacity: 0; transform: translate3d(40px, 0, 0) scale(0.96); }
          to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        }
        .gr-image { opacity: 0; }
        .gr-text  { opacity: 0; }
        .gr-vis .gr-text {
          animation: grInLeft 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards;
        }
        .gr-vis .gr-image {
          animation: grInRight 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.3s forwards;
        }
        .gr-item {
          opacity: 0;
          transform: translate3d(0, 12px, 0);
          transition: opacity 0.6s ease, transform 0.6s ease;
        }
        .gr-vis .gr-item { opacity: 1; transform: translate3d(0, 0, 0); }
        /* Smooth expand/collapse of the accordion body. */
        .gr-body {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .gr-body.gr-open {
          grid-template-rows: 1fr;
        }
        .gr-body > div {
          overflow: hidden;
        }
      `}</style>
      <section
        ref={(el) => {
          if (!el) return;
          if ((el as HTMLElement & { __grBound?: boolean }).__grBound) return;
          (el as HTMLElement & { __grBound?: boolean }).__grBound = true;
          const io = new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                if (e.isIntersecting) {
                  e.target.classList.add("gr-vis");
                  io.disconnect();
                  break;
                }
              }
            },
            { threshold: 0.2 },
          );
          io.observe(el);
        }}
        className="relative py-20 md:py-28 bg-white overflow-hidden"
      >
        <div className="relative max-w-[87rem] mx-auto px-6">
          <div
            className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-10 md:gap-16 lg:gap-20 items-center"
            dir="ltr"
          >
            {/* LEFT — eyebrow + heading + accordion + CTA. */}
            <div className="gr-text text-right" dir="rtl">
              <p className="text-sm mb-3 tracking-[0.2em] font-light uppercase text-black/60">
                حلول شاملة
              </p>
              <h2 className="text-[2rem] md:text-[2.8rem] font-extrabold leading-[1.2] mb-8 md:mb-10 text-black">
                كل ما تحتاجه لتنمو
              </h2>

              <div className="space-y-1">
                {[
                  {
                    title: "سيطرة كاملة وتقليل عبء الإدارة",
                    body:
                      "لوحة تحكم واحدة تجمع كل عمليات الوكالة: وثائق، تحصيل، شيكات، عملاء وتقارير — ترى كل شيء بلحظتها وتتخذ قرارات مبنية على أرقام حقيقية.",
                  },
                  {
                    title: "إدارة الفريق وصلاحيات دقيقة",
                    body:
                      "أنشئ حسابات للموظفين والوسطاء، حدّد صلاحيات كل دور، وتابع نشاط كل مستخدم — الفرع أو الوكالة كلها تحت إدارتك.",
                  },
                  {
                    title: "جدولة المهام والتذكيرات بسهولة",
                    body:
                      "أضف مهام ومتابعات لأي عميل، وخصّص تذكيرات قبل الاستحقاق بأيام أو أسابيع — لا تنسى تجديد، لا تنسى تحصيل، لا تنسى متابعة.",
                  },
                ].map((item, i) => {
                  const open = growAccordionIdx === i;
                  return (
                    <div
                      key={i}
                      className="gr-item border-b border-black/10"
                      style={{ transitionDelay: `${0.45 + i * 0.1}s` }}
                    >
                      <button
                        type="button"
                        onClick={() => setGrowAccordionIdx(open ? -1 : i)}
                        className="w-full py-5 flex items-center gap-4 text-right"
                        aria-expanded={open}
                      >
                        <h3 className="flex-1 text-[16px] md:text-[17px] font-bold text-black leading-snug">
                          {item.title}
                        </h3>
                        <span
                          className={cn(
                            "flex-shrink-0 h-11 w-11 rounded-full flex items-center justify-center transition-colors",
                            open
                              ? "bg-black text-white"
                              : "bg-[#eaeaea] text-black/60",
                          )}
                        >
                          {open ? (
                            <ChevronUp className="h-4 w-4" strokeWidth={2.5} />
                          ) : (
                            <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
                          )}
                        </span>
                      </button>
                      <div className={cn("gr-body", open && "gr-open")}>
                        <div>
                          <p className="text-[14px] md:text-[15px] text-black/60 leading-relaxed pb-5 pl-14">
                            {item.body}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-10">
                <button
                  type="button"
                  onClick={() => navigate("/login?view=signup")}
                  className="px-8 py-3.5 text-[14px] font-bold text-white hover:opacity-90 transition-opacity"
                  style={{
                    borderRadius: "100px",
                    background: "#111",
                    boxShadow: "0 10px 30px -8px rgba(26,26,46,0.25)",
                  }}
                >
                  {ct(content, "hero_cta", "احصل على 35 يوم مجاناً")}
                </button>
              </div>
            </div>

            {/* RIGHT — product mockup. Sits inside a padded card with
                a warm multi-stop gradient so the image reads as a
                hero tile against the white section. */}
            <div
              className="gr-image relative rounded-[28px] overflow-hidden p-8 md:p-10 shadow-[0_40px_100px_-24px_rgba(26,26,46,0.30)]"
              style={{
                background:
                  "linear-gradient(135deg, #6b7fbc 0%, #a8b5d6 20%, #d4b8a0 40%, #c9a88a 55%, #9eadd4 75%, #7b93c8 100%)",
              }}
            >
              <img
                src={featuresMockup}
                alt=""
                className="relative w-full h-auto block rounded-2xl"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Features section — temporarily hidden ═══
          Flip `false` → `true` to restore. Also unhide the
          `#features` nav link above. */}
      {false && <>
      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ Section 3: The big 3 ═══
          Three headline themes each anchored in real CRM capabilities
          (profit engine, paperless, marketing automation). The hero
          block is a gradient+icon placeholder so the section feels
          finished right now — the design is ready to accept an
          <img> per card when the user drops in new artwork (just
          replace the inner contents of the `.bn-hero` div). */}
      <style>{`
        .bn-card {
          opacity: 0;
          transform: translate3d(0, 28px, 0);
          transition:
            opacity 0.8s cubic-bezier(0.22,1,0.36,1),
            transform 0.8s cubic-bezier(0.22,1,0.36,1),
            box-shadow 0.35s ease,
            border-color 0.35s ease;
        }
        .bn-visible .bn-card {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
        .bn-card:hover {
          transform: translate3d(0, -6px, 0);
        }
        .bn-card .bn-icon {
          transition: transform 0.45s cubic-bezier(0.22,1,0.36,1);
        }
        .bn-card:hover .bn-icon {
          transform: scale(1.08) rotate(-4deg);
        }
        .bn-card .bn-hero-num {
          transition: transform 0.6s cubic-bezier(0.22,1,0.36,1), opacity 0.6s ease;
        }
        .bn-card:hover .bn-hero-num {
          transform: scale(1.04) translateX(6px);
          opacity: 0.18;
        }
      `}</style>
      <section
        id="features"
        ref={(el) => {
          if (!el) return;
          if ((el as HTMLElement & { __bnBound?: boolean }).__bnBound) return;
          (el as HTMLElement & { __bnBound?: boolean }).__bnBound = true;
          const io = new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                if (e.isIntersecting) {
                  e.target.classList.add("bn-visible");
                  io.disconnect();
                  break;
                }
              }
            },
            { threshold: 0.15 },
          );
          io.observe(el);
        }}
        className="pt-10 md:pt-14 pb-24 md:pb-32 relative bg-white"
      >
        <div className="max-w-6xl mx-auto px-6 text-center">
          <p className="text-sm text-[#4a6cc7] mb-3 tracking-wide font-semibold">
            {ct(content, "benefits_section_label", "لماذا Thiqa هو الفرق")}
          </p>
          <h2 className="text-3xl md:text-[2.8rem] font-bold leading-tight mb-4 text-black">
            {ct(content, "benefits_section_title", "ثلاثة محاور تقلب طريقة عمل الوكالة")}
          </h2>
          <p className="text-black/55 text-sm max-w-xl mx-auto mb-12">
            {ct(content, "benefits_section_subtitle", "محرك مالي يحسب كل شيكل، ملف رقمي صفر ورق، وأتمتة تسويق تعيد العملاء قبل أن تفقدهم.")}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
            {[
              {
                num: "01",
                icon: Wallet,
                title: "محرك حساب أرباح تلقائي",
                intro:
                  "كل شيكل يدخل ويخرج يُحسب ويُصنَّف تلقائياً — بدون Excel، بدون عمولات ضائعة.",
                bullets: [
                  "أرباح محسوبة حياً على كل وثيقة وكل عميل",
                  "بوابات دفع متعددة (Tranzila أو غيرها) وإدارة كاملة للشيكات",
                  "تسويات تلقائية مع الوسطاء وشركات التأمين",
                ],
                gradient: "linear-gradient(135deg, #ecfdf5 0%, #a7f3d0 100%)",
                accent: "#059669",
              },
              {
                num: "02",
                icon: Shield,
                title: "صفر أوراق، أقصى سرعة",
                intro:
                  "من إصدار الوثيقة حتى تجديدها — كل خطوة رقمية، وكل مستند آمن في السحابة.",
                bullets: [
                  "توقيع رقمي عبر SMS يصل الجوال مباشرة",
                  "إدارة مستندات كاملة مع وصول فوري 24/7",
                  "متابعة دورة الوثيقة من الإصدار للتجديد",
                ],
                gradient: "linear-gradient(135deg, #eef2ff 0%, #c7d2fe 100%)",
                accent: "#4f46e5",
              },
              {
                num: "03",
                icon: MessageSquare,
                title: "تحويل البيانات إلى مبيعات",
                intro:
                  "النظام يعرف متى يذكّر، مع من يتواصل وكيف — فلا تخسر عميلاً ولا تجديد.",
                bullets: [
                  "حملات SMS جماعية مع اختيار عملاء ذكي",
                  "تذكيرات تجديد تلقائية قبل شهر وأسبوع",
                  "تتبع حالة الإرسال مع تقارير DLR",
                ],
                gradient: "linear-gradient(135deg, #fff1f2 0%, #fecdd3 100%)",
                accent: "#e11d48",
              },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <div
                  key={i}
                  className="bn-card relative rounded-2xl border border-black/[0.06] bg-white overflow-hidden text-right shadow-[0_6px_22px_-14px_rgba(18,32,66,0.14)] hover:shadow-[0_24px_60px_-16px_rgba(18,32,66,0.22)] hover:border-[#122042]/15"
                  style={{ transitionDelay: `${i * 120}ms` }}
                >
                  {/* Hero block — swap this div's contents for <img
                      src={yourImage} className="w-full h-full object-cover" />
                      when the artwork lands. The wrapper keeps the
                      4:3 aspect + rounded top corners. */}
                  <div
                    className="bn-hero relative aspect-[4/3] overflow-hidden"
                    style={{ background: card.gradient }}
                  >
                    <div
                      className="absolute inset-0 opacity-[0.2]"
                      style={{
                        backgroundImage:
                          "radial-gradient(circle at 1px 1px, rgba(18,32,66,0.35) 1px, transparent 0)",
                        backgroundSize: "20px 20px",
                      }}
                    />
                    <span
                      className="bn-hero-num absolute top-4 left-6 text-6xl md:text-7xl font-black leading-none opacity-[0.12] pointer-events-none select-none"
                      style={{ color: card.accent }}
                    >
                      {card.num}
                    </span>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div
                        className="bn-icon h-20 w-20 md:h-24 md:w-24 rounded-2xl bg-white/90 backdrop-blur-sm flex items-center justify-center"
                        style={{ boxShadow: `0 18px 40px -14px ${card.accent}66` }}
                      >
                        <Icon
                          className="h-10 w-10 md:h-12 md:w-12"
                          strokeWidth={1.6}
                          style={{ color: card.accent }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-7 md:p-8">
                    <p
                      className="text-[11px] font-bold tracking-[0.18em] mb-2"
                      style={{ color: card.accent }}
                    >
                      {`ميزة ${card.num}`}
                    </p>
                    <h3 className="text-xl font-extrabold mb-3 text-black leading-tight">
                      {card.title}
                    </h3>
                    <p className="text-[13px] text-black/60 leading-relaxed mb-5">
                      {card.intro}
                    </p>
                    <ul className="space-y-2.5">
                      {card.bullets.map((b, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2 text-[13px] text-black/75 leading-relaxed"
                        >
                          <Check
                            className="h-4 w-4 flex-shrink-0 mt-0.5"
                            strokeWidth={3}
                            style={{ color: card.accent }}
                          />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => navigate("/login?view=signup")}
            className="px-10 py-4 text-[15px] font-bold text-white hover:opacity-90 transition-opacity"
            style={{
              borderRadius: "100px",
              background: "#122042",
              boxShadow: "0 12px 30px -8px rgba(18,32,66,0.4)",
            }}
          >
            احصل على 35 يوم مجاناً
          </button>
        </div>
      </section>
      </>}
      {/* ═══ end hidden features section ═══ */}

      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ Section 5: Slider ═══
          Simple auto-advancing slider. No scroll-trap, no body-lock —
          the page scrolls normally through the section. A useEffect
          above starts an interval while the section is in view that
          cycles slideIdx every 4.5s; leaving view stops the
          interval. Cards animate between positions via CSS
          transitions on transform/opacity. Pointer/touch drag lets
          the user swipe between slides; dragging pauses the timer
          for the current tick. */}
      <style>{`
        @keyframes slFadeUp {
          from { opacity: 0; transform: translate3d(0, 24px, 0); }
          to   { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @keyframes slRiseIn {
          from { opacity: 0; transform: translate3d(0, 40px, 0) scale(0.97); }
          to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        }
        .sl-title { opacity: 0; }
        .sl-rail  { opacity: 0; }
        .sl-dots  { opacity: 0; }
        .sl-visible .sl-title {
          animation: slFadeUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0s forwards;
        }
        .sl-visible .sl-rail {
          animation: slRiseIn 0.65s cubic-bezier(0.22, 1, 0.36, 1) 0.15s forwards;
        }
        .sl-visible .sl-dots {
          animation: slFadeUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.4s forwards;
        }
      `}</style>
      <section
        ref={sliderSectionRef}
        className={`relative bg-white overflow-hidden py-20 md:py-28 ${sliderInView ? "sl-visible" : ""}`}
      >
        <img
          src="https://thiqacrm.b-cdn.net/Rectangle%207%20(1).png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          aria-hidden="true"
          loading="lazy"
        />

        <div className="relative z-10 flex flex-col items-center justify-center px-6">
            <h2 className="sl-title select-none text-3xl md:text-[2.6rem] font-bold text-center mb-8 md:mb-12 text-white">
              {ct(content, "slider_title", "لا تنتظر التجديد. اصنعه بنفسك")}
            </h2>

            {(() => {
              const slides = [
                {
                  image: featuresMockup,
                  eyebrow: "تحصيل ومالية",
                  title: "تحصيل بلا Excel،\nشيكات بلا عناء.",
                  desc: "استلم الشيكات مع تسجيل البنك والفرع، وتقسيط داخلي آلي، وربط مع بوابات دفع متعددة — Tranzila أو غيرها حسب الطلب.",
                  cta: "ابدأ التجربة الآن",
                },
                {
                  image: featuresMockup,
                  eyebrow: "تذكيرات وحملات",
                  title: "النظام يذكّر العميل\nقبل ما تفكر فيه.",
                  desc: "تذكيرات قبل شهر وأسبوع من الانتهاء، حملات SMS جماعية، ونماذج مخصّصة لكل تنبيه — نسبة تجديد أعلى بـ 40%.",
                  cta: "ابدأ التجربة الآن",
                },
                {
                  image: featuresMockup,
                  eyebrow: "تقارير لحظية",
                  title: "كل شيكل مرصود،\nكل فرع تحت السيطرة.",
                  desc: "أرباح وعمولات محسوبة بلحظتها، رصيد خزينة حيّ، متابعة أرصدة الشركات، وتصدير فوري إلى Excel.",
                  cta: "ابدأ التجربة الآن",
                },
                {
                  image: featuresMockup,
                  eyebrow: "توقيع ومستندات",
                  title: "وثائق موقّعة في دقائق،\nلا في أسابيع.",
                  desc: "أرسل الوثيقة للعميل عبر SMS، وقّعها بنقرة، وتُؤرشَف مباشرة في ملفه. سجلّ كامل وقابل للمراجعة في أي وقت.",
                  cta: "ابدأ التجربة الآن",
                },
                {
                  image: featuresMockup,
                  eyebrow: "فرق وصلاحيات",
                  title: "كل عضو في فريقك\nيرى ما يخصّه فقط.",
                  desc: "صلاحيات دقيقة لكل دور، فروع منفصلة تحت إدارة واحدة، وسجل أنشطة كامل يوضّح من فعل ماذا ومتى.",
                  cta: "ابدأ التجربة الآن",
                },
              ];

              return (
                <>
                  {/* Three-up card rail — RTL-aware. translateX sign
                      is flipped so "next" slides appear on the LEFT
                      of the current card (natural RTL reading flow)
                      and previously-seen slides stack to the right.
                      Cards are horizontal: image on the right side
                      (flex-row first child reads right-first in RTL),
                      description on the left. Pointer handlers let
                      the user drag/swipe through slides. */}
                  <div
                    className="sl-rail relative w-full max-w-[1280px] h-[460px] md:h-[520px] select-none cursor-grab active:cursor-grabbing"
                    style={{ touchAction: "pan-y" }}
                    onDragStart={(e) => e.preventDefault()}
                    onPointerDown={(e) => {
                      dragStartXRef.current = e.clientX;
                      dragPausedRef.current = true;
                      setIsDragging(true);
                      setDragDelta(0);
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (dragStartXRef.current === null) return;
                      setDragDelta(e.clientX - dragStartXRef.current);
                    }}
                    onPointerUp={(e) => {
                      const start = dragStartXRef.current;
                      dragStartXRef.current = null;
                      dragPausedRef.current = false;
                      setIsDragging(false);
                      setDragDelta(0);
                      if (start === null) return;
                      const delta = e.clientX - start;
                      const threshold = 50;
                      if (Math.abs(delta) < threshold) return;
                      const SLIDES = 5;
                      // RTL: drag-right advances (reveals next from left),
                      // drag-left goes back.
                      if (delta > 0) {
                        setSlideIdx((prev) => (prev + 1) % SLIDES);
                      } else {
                        setSlideIdx((prev) => (prev - 1 + SLIDES) % SLIDES);
                      }
                    }}
                    onPointerCancel={() => {
                      dragStartXRef.current = null;
                      dragPausedRef.current = false;
                      setIsDragging(false);
                      setDragDelta(0);
                    }}
                  >
                    {slides.map((slide, i) => {
                      // Integer offset — CSS `transition` on transform
                      // and opacity turns the discrete index change
                      // into a smooth glide between slide slots. The
                      // 88% spacing keeps adjacent cards mostly to the
                      // side (tiny peek) instead of crashing into the
                      // center card.
                      const offset = i - slideIdx;
                      const abs = Math.abs(offset);
                      // While dragging, scale down slightly so the card
                      // gives a subtle "picked up" cue.
                      const dragScaleBoost = isDragging && abs === 0 ? -0.02 : 0;
                      const scale = (abs === 0 ? 1 : 0.85) + dragScaleBoost;
                      const opacity = abs === 0 ? 1 : abs === 1 ? 0.28 : 0;
                      return (
                        <div
                          key={i}
                          className="absolute top-0 left-1/2 rounded-2xl overflow-hidden w-[760px] md:w-[1060px] h-full flex flex-col will-change-transform"
                          style={{
                            background: "rgba(22, 26, 48, 0.38)",
                            backdropFilter: "blur(24px) saturate(1.2)",
                            WebkitBackdropFilter: "blur(24px) saturate(1.2)",
                            border: "1px solid rgba(255, 255, 255, 0.12)",
                            transform: `translateX(calc(-50% + ${-offset * 88}% + ${dragDelta}px)) scale(${scale})`,
                            opacity,
                            filter: abs === 0 ? "none" : "blur(2px)",
                            pointerEvents: abs === 0 ? "auto" : "none",
                            zIndex: abs === 0 ? 10 : 5,
                            boxShadow: abs === 0 ? "0 30px 80px -16px rgba(10,15,35,0.55)" : "none",
                            transition: isDragging
                              ? "none"
                              : "transform 700ms cubic-bezier(0.4, 0, 0.2, 1), opacity 600ms cubic-bezier(0.4, 0, 0.2, 1), filter 500ms, box-shadow 500ms",
                          }}
                        >
                          {/* Top row: text column + image panel */}
                          <div className="flex flex-row flex-1 min-h-0">
                            {/* First child → right side under RTL:
                                image panel with a subtly darker tint
                                so the mockup reads as a separate plate. */}
                            <div
                              className="w-[46%] h-full flex items-center justify-center p-8 md:p-10 flex-shrink-0"
                              style={{ background: "rgba(10, 14, 30, 0.28)" }}
                            >
                              <img
                                src={slide.image}
                                alt=""
                                draggable={false}
                                className="max-w-full max-h-full object-contain rounded-xl shadow-[0_20px_50px_-12px_rgba(10,15,35,0.5)] pointer-events-none"
                                loading="lazy"
                              />
                            </div>

                            {/* Second child → left side under RTL:
                                text block, right-aligned Arabic copy. */}
                            <div className="flex-1 p-10 md:p-14 flex flex-col justify-center text-white text-right">
                              <span className="text-[11px] text-white/60 font-bold tracking-[0.2em] uppercase mb-4">
                                0{i + 1} · {slide.eyebrow}
                              </span>
                              <h3 className="text-[1.7rem] md:text-[2.1rem] font-bold leading-[1.25] whitespace-pre-line mb-5">
                                {slide.title}
                              </h3>
                              <p className="text-[15px] md:text-[16px] text-white/80 leading-relaxed">
                                {slide.desc}
                              </p>
                            </div>
                          </div>

                          {/* Bottom CTA bar — spans full card width.
                              Diagonal-stripe square at the physical
                              left (end in RTL) holds the arrow. The
                              text sits at the physical right (start
                              in RTL) with generous padding so there's
                              a clear gap between label and arrow. */}
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate("/login?view=signup"); }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="relative flex items-center w-full h-16 md:h-[72px] text-white font-bold text-[14px] md:text-[15px] hover:bg-white/[0.04] transition-colors"
                            style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
                          >
                            <span className="flex-1 text-right px-8 md:px-12">
                              {slide.cta}
                            </span>
                            <div
                              className="h-full w-20 md:w-[88px] flex items-center justify-center border-r border-white/10 flex-shrink-0"
                              style={{
                                backgroundImage:
                                  "repeating-linear-gradient(-45deg, rgba(255,255,255,0.09) 0, rgba(255,255,255,0.09) 1px, transparent 1px, transparent 9px)",
                              }}
                            >
                              <ArrowLeft className="h-4 w-4" />
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Progress dots — driven by slideIdx, doubles as
                      a "where am I in the scroll lock" indicator. */}
                  <div className="sl-dots flex gap-2 mt-8">
                    {slides.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setSlideIdx(i)}
                        aria-label={`slide ${i + 1}`}
                        className="h-1 rounded-full transition-all duration-500 cursor-pointer"
                        style={{
                          width: i === slideIdx ? "2rem" : "1rem",
                          background: i === slideIdx ? "#ffffff" : "rgba(255,255,255,0.35)",
                        }}
                      />
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
      </section>


      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ Section 5: Grid Logo ═══
          One big hero image with a typewriter-reveal title and
          staggered fade-ups on the description + CTA. Image is
          edge-to-edge (no max-width cap). IntersectionObserver
          toggles `.gl-visible` on first view so the whole section
          plays a single coordinated animation sequence. */}
      <style>{`
        @keyframes glTypeRtl {
          from { clip-path: inset(0 0 0 100%); }
          to   { clip-path: inset(0 0 0 0); }
        }
        @keyframes glFadeUp {
          from { opacity: 0; transform: translate3d(0, 12px, 0); }
          to   { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @keyframes glImageIn {
          from { opacity: 0; transform: scale(0.985); }
          to   { opacity: 1; transform: scale(1); }
        }
        .gl-type { display: inline-block; clip-path: inset(0 0 0 100%); }
        .gl-fade { opacity: 0; }
        .gl-image { opacity: 0; transform: scale(0.985); }
        .gl-visible .gl-type-label {
          animation: glTypeRtl 0.35s steps(10, end) 0s forwards;
        }
        .gl-visible .gl-type-title {
          animation: glTypeRtl 0.55s steps(18, end) 0.1s forwards;
        }
        .gl-visible .gl-image {
          animation: glImageIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) 0.05s forwards;
        }
        .gl-visible .gl-fade-desc {
          animation: glFadeUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.35s forwards;
        }
        .gl-visible .gl-fade-cta {
          animation: glFadeUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.45s forwards;
        }
      `}</style>
      <section
        ref={(el) => {
          if (!el) return;
          if ((el as HTMLElement & { __glBound?: boolean }).__glBound) return;
          (el as HTMLElement & { __glBound?: boolean }).__glBound = true;
          const io = new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                if (e.isIntersecting) {
                  e.target.classList.add("gl-visible");
                  io.disconnect();
                  break;
                }
              }
            },
            { threshold: 0.2 },
          );
          io.observe(el);
        }}
        className="relative pt-10 md:pt-14 pb-24 md:pb-32 overflow-hidden bg-white"
      >
        <div className="relative z-10 text-center px-6 mb-10 md:mb-14">
          <p className="text-[13px] md:text-sm mb-4 tracking-[0.2em] font-semibold uppercase">
            <span className="gl-type gl-type-label text-[#4a6cc7]">
              {ct(content, "grid_label", "حل شامل وبسيط")}
            </span>
          </p>
          <h2 className="text-[2rem] md:text-[3.2rem] font-extrabold leading-[1.15] text-black">
            <span className="gl-type gl-type-title">
              {ct(content, "grid_title", "كل ما تحتاجه الوكالة، تحت سقف واحد")}
            </span>
          </h2>
        </div>

        {/* Full-width hero image — edge to edge. */}
        <div className="relative w-full gl-image">
          <img
            src="https://thiqacrm.b-cdn.net/Group%201000011508%20(1).png"
            alt=""
            className="w-full h-auto block"
            loading="lazy"
          />
        </div>

        <div className="relative z-10 text-center px-6 mt-10">
          <p className="gl-fade gl-fade-desc text-[14px] md:text-[15px] text-black/60 max-w-xl mx-auto mb-8 leading-relaxed whitespace-pre-line">
            {ct(content, "grid_desc", "إرسال وثائق للتوقيع الرقمي عبر SMS، إدارة مستندات آمنة في السحابة\nومتابعة كاملة لدورة حياة الوثيقة — كل شيء من الكمبيوتر أو الجوال.")}
          </p>
          <button
            onClick={() => navigate("/login?view=signup")}
            className="gl-fade gl-fade-cta px-8 py-3 text-[14px] font-bold text-white hover:opacity-90 transition-opacity"
            style={{
              borderRadius: "100px",
              background: "#111",
              boxShadow: "0 4px 16px 0 rgba(0, 0, 0, 0.12)",
            }}
          >
            {ct(content, "hero_cta", "احصل على 35 يوم مجاناً")}
          </button>
        </div>
      </section>


      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ Section 6: Testimonials ═══ */}
      <section id="testimonials" ref={testimonialsSectionRef} className="py-24 md:py-36 relative overflow-hidden bg-white">
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
                <button
                  key={i}
                  onClick={() => {
                    if (i === testimonialIdx) return;
                    testimonialTickRef.current++;
                    setTestimonialAnim("out");
                    setTimeout(() => {
                      setTestimonialIdx(i);
                      setTestimonialAnim("in");
                    }, 350);
                  }}
                  aria-label={`testimonial ${i + 1}`}
                  className={`h-1 rounded-full transition-all duration-500 cursor-pointer ${
                    i === testimonialIdx ? "w-10 bg-[#4a6cc7]" : "w-6 bg-black/[0.12] hover:bg-black/[0.2]"
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

      {/* ═══ FAQ ═══
          Single-column accordion, first item open by default, at most
          one open at a time. Clean dividers between rows, circular
          chevron control on the end side. */}
      <section id="faq" className="py-24 md:py-36 relative bg-white">
        <div className="relative max-w-4xl mx-auto px-6">
          <p className="text-sm text-[#4a6cc7] text-center mb-4 tracking-wide font-semibold">{ct(content, "faq_label", "أسئلة وأجوبة")}</p>
          <h2 className="text-3xl md:text-[2.8rem] font-bold text-center mb-16 text-black">
            {ct(content, "faq_title", "كل ما يهمك معرفته عن Thiqa")}
          </h2>

          <div className="flex flex-col">
            {(() => {
              const faqs: { q: string; a: string }[] = [
                {
                  q: "ما هو Thiqa؟",
                  a: "نظام CRM مخصّص لوكالات التأمين — إدارة العملاء والوثائق والمدفوعات والتقارير في مكان واحد. مصمّم لواقع الوكالات في منطقتنا مع دعم كامل للعربية وواجهة RTL احترافية.",
                },
                {
                  q: "هل يمكنني إلغاء الاشتراك في أي وقت؟",
                  a: "نعم، الإلغاء مجاني ومتاح في أي وقت بدون التزام أو رسوم إضافية. عند الإلغاء نرسل لك نسخة احتياطية كاملة من قاعدة بياناتك لتحتفظ بها، وتبقى لديك إمكانية العودة متى شئت بنفس البيانات.",
                },
                {
                  q: "هل يمكن الانتقال بين خطة Pro وBasic؟",
                  a: "نعم. الترقية من Basic إلى Pro تتم فوراً من صفحة الاشتراك وتُفعَّل الميزات الإضافية مباشرة. الانتقال من Pro إلى Basic متاح أيضاً في أي وقت، ويُحتسب فرق السعر بالتناسب مع المدة المتبقية في فاتورتك القادمة.",
                },
                {
                  q: "هل يوجد فترة تجريبية مجانية؟",
                  a: "نعم، 35 يوماً تجربة مجانية بدون الحاجة لبطاقة ائتمان. جميع ميزات خطة Pro متاحة خلال التجربة لتختبر النظام بالكامل قبل الاشتراك.",
                },
                {
                  q: "هل معلوماتي وبيانات عملائي آمنة؟",
                  a: "نعم — تشفير متقدم لجميع البيانات، نسخ احتياطية يومية تلقائية، ونظام صلاحيات كامل يتحكم بمن يستطيع الوصول إلى أي معلومة داخل وكالتك. أنتم الوحيدون الذين يصلون لبياناتكم.",
                },
              ];
              return faqs.map((faq, i) => {
                const isOpen = openFaq === i;
                const isLast = i === faqs.length - 1;
                return (
                  <div key={i}>
                    <button
                      onClick={() => setOpenFaq(isOpen ? null : i)}
                      className="w-full flex items-center gap-4 py-6 md:py-7 text-right group"
                      aria-expanded={isOpen}
                    >
                      <h3 className="flex-1 text-right font-bold text-[16px] md:text-[18px] text-black leading-snug">
                        {faq.q}
                      </h3>
                      <div
                        className={`h-11 w-11 md:h-12 md:w-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                          isOpen
                            ? "bg-black text-white"
                            : "bg-black/[0.05] text-black group-hover:bg-black/[0.08]"
                        }`}
                      >
                        {isOpen ? (
                          <ChevronUp className="h-4 w-4" strokeWidth={2.5} />
                        ) : (
                          <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
                        )}
                      </div>
                    </button>
                    <div
                      className="grid overflow-hidden transition-all duration-300 ease-out"
                      style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                    >
                      <div className="min-h-0">
                        <p className="text-right text-[14px] md:text-[15px] text-black/60 leading-relaxed pb-6 md:pb-7 pl-14 md:pl-16">
                          {faq.a}
                        </p>
                      </div>
                    </div>
                    {!isLast && <div className="h-px bg-black/[0.08]" />}
                  </div>
                );
              });
            })()}
          </div>

          <p className="mt-12 text-center text-[14px] md:text-[15px] text-black/55">
            {ct(content, "faq_more_prompt", "هل لديك أسئلة إضافية؟")}{" "}
            <button
              onClick={() => navigate("/login?view=signup")}
              className="font-bold text-black underline underline-offset-4 decoration-2 decoration-[#4a6cc7] hover:opacity-80 transition-opacity"
            >
              {ct(content, "faq_more_cta", "تواصل معنا.")}
            </button>
          </p>
        </div>
      </section>


      <img src={SECTION_DIVIDER_URL} alt="" className="w-full h-auto block" aria-hidden="true" loading="lazy" />

      {/* ═══ CTA ═══
          Bold question headline + subtitle + two CTAs (filled
          primary / outlined secondary) + a product image anchoring
          the bottom. Background gradient preserved per user spec. */}
      <section className="relative overflow-hidden rounded-2xl mx-4 md:mx-8 lg:mx-16 my-8">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(135deg, #6b7fbc 0%, #a8b5d6 20%, #d4b8a0 40%, #c9a88a 55%, #9eadd4 75%, #7b93c8 100%)",
          }}
        />
        <div className="relative pt-20 md:pt-24 px-6 text-center">
          <h2 className="text-[2.4rem] md:text-[3.4rem] font-extrabold leading-[1.12] text-[#1a1a2e] mb-5">
            قلنا لكم إنها مجاناً؟
          </h2>
          <p className="text-base md:text-lg text-[#1a1a2e]/75 max-w-xl mx-auto mb-10 leading-relaxed">
            انضموا إلى ثقة بالخطة الأساسية — ستعرف وكالتكم الفرق من اليوم الأول.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mb-14 md:mb-16">
            <button
              type="button"
              onClick={() => navigate("/login?view=signup")}
              className="bg-white hover:bg-white/95 text-[#1a1a2e] rounded-full px-10 h-[52px] text-sm font-bold shadow-[0_10px_30px_-8px_rgba(26,26,46,0.35)] transition-colors"
            >
              اشتركوا مجاناً
            </button>
            <button
              type="button"
              onClick={() => {
                document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="bg-transparent hover:bg-[#1a1a2e]/5 text-[#1a1a2e] border border-[#1a1a2e]/30 rounded-full px-10 h-[52px] text-sm font-bold transition-colors"
            >
              كل الخطط
            </button>
          </div>

          {/* Bottom mockup image — placeholder for now; swap via the
              `src` when the final artwork is ready. */}
          <div className="max-w-3xl mx-auto">
            <img
              src={featuresMockup}
              alt=""
              className="w-full h-auto block"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      {/* ═══ Demo-call CTA ═══
          White rounded card with three tilted feature cards peeking
          above it. The card is the "book a 1:1 demo" pitch that sits
          between the marketing copy and the footer — low-commitment,
          personal-touch ask for visitors who aren't ready to sign up
          without seeing the product live. */}
      <section className="relative bg-white pt-28 md:pt-36 pb-20 md:pb-28">
        <div className="relative max-w-4xl mx-auto px-6">
          {/* Tilted peek cards. They overhang the top of the white
              card (negative bottom margin pulls the card up to
              overlap them). Each has a small pill label describing
              a Thiqa area — dashboard, reports, clients. */}
          <div className="relative h-44 md:h-52 flex items-end justify-center gap-3 md:gap-6">
            {[
              { img: dashboardMockupDefault, label: "لوحة القيادة", rotate: -10, y: 10 },
              { img: featuresMockup, label: "التقارير", rotate: 0, y: 0 },
              { img: dashboardMockupDefault, label: "العملاء", rotate: 10, y: 10 },
            ].map((card, i) => (
              <div
                key={i}
                className="relative w-[140px] h-[96px] md:w-[180px] md:h-[120px] rounded-xl overflow-hidden bg-white border border-black/[0.06] shadow-[0_12px_30px_-10px_rgba(0,0,0,0.15)]"
                style={{
                  transform: `rotate(${card.rotate}deg) translateY(${card.y}px)`,
                  zIndex: i === 1 ? 3 : 1,
                }}
              >
                <img
                  src={card.img}
                  alt=""
                  className="w-full h-full object-cover"
                  draggable={false}
                  loading="lazy"
                />
                {/* Label pill — small beige chip on the card corner. */}
                <div
                  className="absolute -top-3 right-3 flex items-center gap-2 bg-[#E8E0D0] text-black/70 text-[11px] font-semibold rounded-full px-3 py-1 shadow-sm"
                  style={{ transform: `rotate(${-card.rotate}deg)` }}
                >
                  <span className="h-4 w-4 rounded-full bg-black/15 flex-shrink-0" />
                  {card.label}
                </div>
              </div>
            ))}
          </div>

          {/* Main card — white, rounded, subtle shadow. Sits -40px
              upward so the peek cards appear tucked behind it. */}
          <div className="relative -mt-10 md:-mt-14 bg-white rounded-[2.5rem] border border-black/[0.06] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.12)] px-6 pt-16 md:pt-20 pb-12 md:pb-16 text-center">
            <h2 className="text-[1.8rem] md:text-[2.6rem] font-extrabold text-black leading-[1.2] mb-4">
              {ct(content, "demo_title", "نريكم Thiqa في مكالمة؟")}
            </h2>
            <p className="text-[14px] md:text-[16px] text-black/55 max-w-xl mx-auto mb-10 leading-relaxed">
              {ct(content, "demo_subtitle", "مكالمة واحد-لواحد مع ممثّل لعرض عملي للنظام — بدون التزام وبدون أي تكلفة.")}
            </p>
            <button
              onClick={() => navigate("/login?view=signup")}
              className="inline-flex items-center gap-2 bg-[#E8E0D0] hover:bg-[#ddd4c0] text-black font-bold text-[14px] md:text-[15px] rounded-full px-8 py-4 transition-colors"
            >
              {ct(content, "demo_cta", "احجز مكالمة تجريبية")}
            </button>
          </div>
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
