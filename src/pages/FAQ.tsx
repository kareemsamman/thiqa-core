import { useState, useEffect, useMemo } from "react";
import { usePageView, trackEvent } from "@/hooks/useAnalyticsTracker";
import { DemoCallTrigger } from "@/components/public/DemoCallDialog";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown, ChevronUp, Menu, X, Search, Play, Sparkles, Star, CheckCircle,
  HelpCircle, MessageSquare,
} from "lucide-react";
import { useLandingContent, ct } from "@/hooks/useLandingContent";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
import { cn } from "@/lib/utils";
import { PublicSEO } from "@/components/public/PublicSEO";
import { PublicFooter } from "@/components/public/PublicFooter";
import { FaqPageJsonLd } from "@/components/public/PublicJsonLd";
import { PublicGradientBackground } from "@/components/public/PublicGradientBackground";
import { FAQ_CATEGORIES, flattenFaq, type FlatFaqItem } from "@/lib/faqContent";

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

export default function FAQ() {
  usePageView("/faq");
  const { data: content } = useLandingContent();
  const navigate = useNavigate();

  const [activeCategoryId, setActiveCategoryId] = useState<string>(FAQ_CATEGORIES[0].id);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSubmenu, setMobileSubmenu] = useState<"info" | "support" | null>(null);

  // Flatten the catalog once and filter against the live search input.
  // Empty query → no filtering, the active tab takes over.
  const allItems = useMemo(() => flattenFaq(), []);
  const trimmedQuery = searchQuery.trim();
  const searchResults: FlatFaqItem[] = useMemo(() => {
    if (!trimmedQuery) return [];
    const q = trimmedQuery.toLowerCase();
    return allItems.filter(
      (it) =>
        it.q.toLowerCase().includes(q) ||
        it.a.toLowerCase().includes(q) ||
        it.categoryLabel.toLowerCase().includes(q),
    );
  }, [trimmedQuery, allItems]);

  const isSearching = trimmedQuery.length > 0;
  const activeCategory = FAQ_CATEGORIES.find((c) => c.id === activeCategoryId) ?? FAQ_CATEGORIES[0];

  // Build a unique key per Q so the open-row logic survives across
  // category switches without colliding on duplicate question texts.
  const qKey = (categoryId: string, subTitle: string, q: string) => `${categoryId}::${subTitle}::${q}`;

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
        title="الأسئلة الشائعة Thiqa — دليل نظام إدارة وكالات التأمين"
        description="إجابات على الأسئلة الشائعة حول نظام Thiqa لإدارة وكالات التأمين: التسعير، الميزات، الأمان، الدعم الفني، والبدء بالاستخدام."
        keywords="أسئلة Thiqa, مساعدة Thiqa, دليل النظام, أسئلة شائعة, دعم وكالات التأمين, ثقة"
      />
      <FaqPageJsonLd items={allItems.map((it) => ({ q: it.q, a: it.a }))} />

      <PublicGradientBackground />

      {/* ═══ Navbar — duplicated from Pricing for now (extraction is a
          separate task). FAQ link in INFO_CENTER_ITEMS now points to
          this page. */}
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
                    onClick={() => trackEvent("signup_click", "/faq:nav-info-card")}
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
                    const className = "w-full flex items-center gap-4 rounded-xl px-3 py-3 hover:bg-black/[0.03] transition-colors text-right";
                    if ("demo" in item && item.demo) {
                      return (
                        <DemoCallTrigger key={item.title} className={className}>
                          {inner}
                        </DemoCallTrigger>
                      );
                    }
                    return (
                      <a key={item.title} href={item.href} className={className}>
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
              onClick={() => { trackEvent("signup_click", "/faq"); navigate("/register"); }}
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
                        const className = "w-full flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-black/[0.03] transition-colors text-right";
                        return (
                          <li key={item.title}>
                            {"demo" in item && item.demo ? (
                              <DemoCallTrigger className={className}>
                                {inner}
                              </DemoCallTrigger>
                            ) : (
                              <a
                                href={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={className}
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
              onClick={() => { trackEvent("signup_click", "/faq"); setMobileMenuOpen(false); navigate("/register"); }}
              className="w-full py-4 text-[15px] font-bold text-white bg-black rounded-full hover:bg-black/90 transition-all shadow-[0_6px_20px_-6px_rgba(0,0,0,0.4)]"
            >
              {ct(content, "navbar_cta", "احصل على 35 يوم مجاناً")}
            </button>
          </div>
        </aside>
      </div>

      {/* ═══ Hero — same gradient band the pricing page rides on, with
          a centered title + subtitle. Search bar sits below in white
          card so it's visually anchored as the entry point. */}
      <section className="relative z-10 pt-32 md:pt-40 pb-8 md:pb-12 text-center px-6">
        <p className="text-sm text-black/65 mb-4 tracking-wide font-medium">
          أسئلة وأجوبة
        </p>
        <h1 className="text-[2rem] md:text-[3rem] lg:text-[3.4rem] font-bold mb-5 leading-[1.15] text-black">
          كل ما يهمك معرفته عن Thiqa
        </h1>
        <p className="text-black/70 text-[15px] md:text-base max-w-2xl mx-auto leading-relaxed">
          إجابات على الأسئلة الأكثر شيوعاً من وكلاء التأمين — التسجيل، الميزات، التكاملات، والدعم.
        </p>
      </section>

      {/* ═══ Search bar — centered, prominent. Filters across all
          categories live as the user types. */}
      <section className="relative z-10 px-4 md:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="relative">
            <Search className="absolute right-5 top-1/2 -translate-y-1/2 h-5 w-5 text-black/35" strokeWidth={2} />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث عن سؤال أو موضوع…"
              className="w-full h-14 pr-14 pl-12 rounded-full bg-white border border-black/15 text-[15px] text-black placeholder:text-black/35 outline-none focus:border-black/40 transition-colors shadow-[0_4px_24px_-8px_rgba(0,0,0,0.12)]"
              aria-label="ابحث في الأسئلة الشائعة"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute left-4 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-black/[0.06] hover:bg-black/[0.10] flex items-center justify-center transition-colors"
                aria-label="مسح البحث"
              >
                <X className="h-3.5 w-3.5 text-black/60" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ═══ Body — when searching: flat results across all categories.
          Otherwise: horizontal category tabs + the active category's
          subcategory groups with accordion Q&As. */}
      <section className="relative z-10 pt-10 md:pt-14 pb-24 px-4 md:px-6">
        <div className="max-w-5xl mx-auto">
          {isSearching ? (
            <SearchResults
              results={searchResults}
              query={trimmedQuery}
              openQuestion={openQuestion}
              setOpenQuestion={setOpenQuestion}
              qKey={qKey}
            />
          ) : (
            <>
              {/* Tabs row */}
              <div className="flex gap-2 overflow-x-auto pb-3 mb-8 scrollbar-thin">
                {FAQ_CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isActive = cat.id === activeCategoryId;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setActiveCategoryId(cat.id);
                        setOpenQuestion(null);
                      }}
                      className={cn(
                        "shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[13.5px] font-semibold transition-colors",
                        isActive
                          ? "bg-black text-white"
                          : "bg-black/[0.04] text-black/70 hover:bg-black/[0.08] hover:text-black",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                      {cat.label}
                    </button>
                  );
                })}
              </div>

              {/* Category description */}
              <div className="mb-8">
                <h2 className="text-2xl md:text-3xl font-bold text-black mb-2">
                  {activeCategory.label}
                </h2>
                <p className="text-[14px] md:text-[15px] text-black/60 leading-relaxed">
                  {activeCategory.description}
                </p>
              </div>

              {/* Subcategory groups + accordions */}
              <div className="space-y-12">
                {activeCategory.subcategories.map((sub) => (
                  <div key={sub.title}>
                    <h3 className="text-[13px] font-bold uppercase tracking-[0.18em] text-[#7C5CFF] mb-4">
                      {sub.title}
                    </h3>
                    <div className="flex flex-col">
                      {sub.items.map((item, i) => {
                        const key = qKey(activeCategory.id, sub.title, item.q);
                        const isOpen = openQuestion === key;
                        const isLast = i === sub.items.length - 1;
                        return (
                          <FaqRow
                            key={key}
                            question={item.q}
                            answer={item.a}
                            isOpen={isOpen}
                            isLast={isLast}
                            onToggle={() => setOpenQuestion(isOpen ? null : key)}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="mt-16 text-center text-[14px] md:text-[15px] text-black/55">
            لم تجد إجابة سؤالك؟{" "}
            <a
              href="/contact"
              className="font-bold text-black hover:opacity-80 transition-opacity"
            >
              راسلنا مباشرة.
            </a>
          </p>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

// One question + answer row in the accordion. Same circular-chevron
// visual treatment as the shared FAQSection used on /landing#faq and
// /pricing — keeps the FAQ aesthetic consistent across surfaces.
function FaqRow({
  question,
  answer,
  isOpen,
  isLast,
  onToggle,
}: {
  question: string;
  answer: string;
  isOpen: boolean;
  isLast: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 py-5 md:py-6 text-right group"
        aria-expanded={isOpen}
      >
        <h4 className="flex-1 text-right font-bold text-[15px] md:text-[17px] text-black leading-snug">
          {question}
        </h4>
        <div
          className={cn(
            "h-10 w-10 md:h-11 md:w-11 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300",
            isOpen
              ? "bg-black text-white"
              : "bg-black/[0.05] text-black group-hover:bg-black/[0.08]",
          )}
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
          <p className="text-right text-[14px] md:text-[15px] text-black/65 leading-relaxed pb-5 md:pb-6 pl-14 md:pl-16">
            {answer}
          </p>
        </div>
      </div>
      {!isLast && <div className="h-px bg-black/[0.08]" />}
    </div>
  );
}

// Search-mode renderer. Highlights the query inside both question and
// answer text, and prefixes each row with its category label so users
// always know where a result lives in the catalog.
function SearchResults({
  results,
  query,
  openQuestion,
  setOpenQuestion,
  qKey,
}: {
  results: FlatFaqItem[];
  query: string;
  openQuestion: string | null;
  setOpenQuestion: (k: string | null) => void;
  qKey: (categoryId: string, subTitle: string, q: string) => string;
}) {
  if (results.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[15px] text-black/55 mb-2">لا توجد نتائج تطابق بحثك عن:</p>
        <p className="text-[17px] font-bold text-black">"{query}"</p>
        <p className="mt-6 text-[14px] text-black/55">
          جرّب كلمات مختلفة، أو{" "}
          <a href="/contact" className="font-bold text-black hover:opacity-80 transition-opacity">
            تواصل معنا
          </a>{" "}
          مباشرة.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[13px] text-black/55 mb-4">
        {results.length} نتيجة لـ <span className="font-bold text-black">"{query}"</span>
      </p>
      <div className="flex flex-col">
        {results.map((item, i) => {
          const key = qKey(item.categoryId, item.subcategoryTitle, item.q);
          const isOpen = openQuestion === key;
          const isLast = i === results.length - 1;
          return (
            <div key={key}>
              <button
                onClick={() => setOpenQuestion(isOpen ? null : key)}
                className="w-full flex items-center gap-4 py-5 md:py-6 text-right group"
                aria-expanded={isOpen}
              >
                <div className="flex-1 text-right">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#7C5CFF] mb-1">
                    {item.categoryLabel} · {item.subcategoryTitle}
                  </p>
                  <h4 className="font-bold text-[15px] md:text-[17px] text-black leading-snug">
                    {item.q}
                  </h4>
                </div>
                <div
                  className={cn(
                    "h-10 w-10 md:h-11 md:w-11 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300",
                    isOpen
                      ? "bg-black text-white"
                      : "bg-black/[0.05] text-black group-hover:bg-black/[0.08]",
                  )}
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
                  <p className="text-right text-[14px] md:text-[15px] text-black/65 leading-relaxed pb-5 md:pb-6 pl-14 md:pl-16">
                    {item.a}
                  </p>
                </div>
              </div>
              {!isLast && <div className="h-px bg-black/[0.08]" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
