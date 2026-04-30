import { useState, useEffect } from "react";
import { usePageView, trackEvent } from "@/hooks/useAnalyticsTracker";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown, Menu, X, Play, Sparkles, Star, HelpCircle, MessageSquare, CheckCircle,
  Mail, Phone,
} from "lucide-react";
import { useLandingContent, ct } from "@/hooks/useLandingContent";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
import { cn } from "@/lib/utils";
import { PublicSEO } from "@/components/public/PublicSEO";
import { BreadcrumbJsonLd, ContactPageJsonLd } from "@/components/public/PublicJsonLd";
import { DemoCallTrigger } from "@/components/public/DemoCallDialog";
import { SupportContactForm } from "@/components/public/SupportContactForm";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicGradientBackground } from "@/components/public/PublicGradientBackground";

// Public "Contact us" surface — the support form used to live as a
// trailing section on /faq#support, but mixing the FAQ catalog and a
// separate contact form on the same page made each feel cramped. Now
// FAQ is purely the catalog and this page owns the contact flow.
//
// Visual recipe matches Pricing/FAQ: purple gradient band at the top
// behind the navbar + hero, then a centered card with the form on
// white. Navbar is duplicated from Pricing for now (extraction is a
// separate task — same pattern FAQ.tsx already uses).

const INFO_CENTER_ITEMS = [
  { title: "كل الأدوات", desc: "إدارة الوكالة تحت سقف واحد", icon: Play, href: "/landing#demo" },
  { title: "لماذا ثقة", desc: "ثلاثة محاور تقلب طريقة عمل الوكالة", icon: Sparkles, href: "/landing#features" },
  { title: "آراء العملاء", desc: "ماذا يقول عملاؤنا عن النظام", icon: Star, href: "/landing#testimonials" },
  { title: "أسئلة وأجوبة", desc: "إجابات على الاستفسارات الشائعة", icon: HelpCircle, href: "/faq" },
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

export default function ContactUs() {
  usePageView("/contact");
  const { data: content } = useLandingContent();
  const navigate = useNavigate();

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

  return (
    <div
      className="min-h-screen text-black overflow-x-hidden relative bg-white public-page-enter"
      dir="rtl"
      style={{ fontFamily: "'Cairo', sans-serif" }}
    >
      <PublicSEO
        title="تواصل معنا Thiqa — دعم نظام إدارة وكالات التأمين"
        description="تواصل مع فريق Thiqa — أرسل استفسارك أو طلب الدعم وسنرد عليك في أسرع وقت ممكن. نحن هنا للإجابة على كل أسئلتك حول نظام إدارة وكالات التأمين."
        keywords="تواصل معنا Thiqa, دعم Thiqa, اتصل بنا, مساعدة وكالات التأمين, ثقة"
      />
      <BreadcrumbJsonLd
        crumbs={[
          { label: "Thiqa", href: "/" },
          { label: "تواصل معنا", href: "/contact" },
        ]}
      />
      <ContactPageJsonLd />

      <PublicGradientBackground />

      {/* ═══ Navbar — duplicated from Pricing/FAQ (extraction TBD). */}
      <nav className="fixed inset-x-0 top-0 z-50 pointer-events-none mt-3">
        <div className="pointer-events-auto flex flex-row-reverse lg:flex-row items-center justify-between lg:justify-normal px-4 lg:px-6 h-14 lg:h-16 mx-auto w-[92%] lg:w-[75%] max-w-[72rem] rounded-full bg-white/75 backdrop-blur-md shadow-[0_1px_20px_0_rgba(0,0,0,0.10)]">
          <div className="lg:flex-1 lg:flex lg:justify-start">
            <a href="/landing" className="flex items-center text-black">
              <ThiqaLogoAnimation
                iconSize={32}
                interactive={false}
                iconSrc="https://thiqacrm.b-cdn.net/small_black.png"
              />
            </a>
          </div>

          <div className="hidden lg:flex items-center gap-10 text-[14px] font-medium text-black/75">
            <a href="/pricing" className="hover:text-black transition-colors">الأسعار</a>

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
                    onClick={() => trackEvent("signup_click", "/contact:nav-info-card")}
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

          <div className="lg:flex-1 flex flex-row-reverse lg:flex-row lg:justify-end items-center gap-3 lg:gap-5">
            <button
              onClick={() => navigate("/login")}
              className="text-[14px] font-semibold text-black/80 hover:text-black transition-colors inline-flex items-center"
            >
              {ct(content, "navbar_login", "تسجيل الدخول")}
            </button>

            <button
              onClick={() => { trackEvent("signup_click", "/contact"); navigate("/register"); }}
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

      {/* Mobile drawer */}
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
              onClick={() => { trackEvent("signup_click", "/contact"); setMobileMenuOpen(false); navigate("/register"); }}
              className="w-full py-4 text-[15px] font-bold text-white bg-black rounded-full hover:bg-black/90 transition-all shadow-[0_6px_20px_-6px_rgba(0,0,0,0.4)]"
            >
              {ct(content, "navbar_cta", "احصل على 35 يوم مجاناً")}
            </button>
          </div>
        </aside>
      </div>

      {/* ═══ Hero — same gradient band, white copy. */}
      <section className="relative z-10 pt-32 md:pt-40 pb-12 md:pb-16 text-center px-6">
        <p className="text-sm text-black/65 mb-4 tracking-wide font-medium">
          تواصل معنا
        </p>
        <h1 className="text-[2rem] md:text-[3rem] lg:text-[3.4rem] font-bold mb-5 leading-[1.15] text-black">
          نحن هنا لمساعدتك
        </h1>
        <p className="text-black/70 text-[15px] md:text-base max-w-xl mx-auto leading-relaxed">
          أرسل لنا استفسارك أو طلب الدعم وسنرد عليك في أسرع وقت ممكن.
        </p>
      </section>

      {/* ═══ Form card — sits where the gradient fades to white, so
          the card lands cleanly on the lighter portion of the band.
          Below it: a compact contact strip mirroring the channels in
          the footer (email + two phones) so the page itself answers
          "how else can I reach you?" without scrolling all the way
          down. */}
      <section className="relative z-10 pb-24 md:pb-32 px-4 md:px-6">
        <div className="max-w-3xl mx-auto">
          <SupportContactForm />

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ContactPill
              icon={Mail}
              label="راسلنا على البريد"
              value="support@getthiqa.com"
              href="mailto:support@getthiqa.com"
              dir="ltr"
            />
            <ContactPill
              icon={Phone}
              label="اتصل بنا"
              value="0525143581"
              href="tel:+972525143581"
              dir="ltr"
            />
            <ContactPill
              icon={Phone}
              label="أو على"
              value="0598 948 155"
              href="tel:+972598948155"
              dir="ltr"
            />
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

// Contact channel pill rendered under the form. Circular icon on the
// right (RTL start), label + value on the left. The label is the
// soft cue ("راسلنا على البريد") and the value is the actual contact
// detail rendered in LTR so digits/email don't get mirrored.
function ContactPill({
  icon: Icon,
  label,
  value,
  href,
  dir,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  href: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 rounded-2xl bg-white border border-black/[0.06] px-4 py-3 hover:border-black/20 transition-colors text-right"
    >
      <span className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-black/[0.05] text-black">
        <Icon className="h-4 w-4" strokeWidth={2.2} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12px] text-black/55 leading-tight mb-0.5">{label}</span>
        <span className="block text-[14px] font-bold text-black truncate" dir={dir}>{value}</span>
      </span>
    </a>
  );
}
