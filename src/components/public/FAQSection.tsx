import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useLandingContent, ct } from "@/hooks/useLandingContent";
import { cn } from "@/lib/utils";

// FAQ data — single source of truth shared by every public surface
// that renders the accordion (landing page, pricing page) AND the
// Landing FAQPage JSON-LD, so a wording change can never put any of
// them out of sync.
export const LANDING_FAQS: { q: string; a: string }[] = [
  {
    q: "ما هو Thiqa؟",
    a: "نظام إدارة مخصّص لوكالات التأمين — إدارة العملاء والمعاملات والمدفوعات والتقارير في مكان واحد. مصمّم لواقع الوكالات في منطقتنا مع دعم كامل للعربية وواجهة RTL احترافية.",
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

/**
 * Shared FAQ accordion used on /landing#faq and /pricing.
 *
 * Editing the questions/answers here updates both surfaces at once —
 * and Landing.tsx reads the same `LANDING_FAQS` export to build its
 * FAQPage JSON-LD, so SEO stays in lock-step with the visible copy.
 */
export function FAQSection({ compact = false }: { compact?: boolean } = {}) {
  const { data: content } = useLandingContent();
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Trigger the stagger entrance only once the section scrolls into
  // view — otherwise the animation finishes before the user reaches
  // it on the long landing page. Users with reduced-motion skip the
  // hidden-then-animate step entirely so rows render immediately.
  const sectionRef = useRef<HTMLElement | null>(null);
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [inView, setInView] = useState(reducedMotion);
  useEffect(() => {
    const node = sectionRef.current;
    if (!node || inView) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);

  return (
    <section
      ref={sectionRef}
      id="faq"
      className={cn(
        "relative bg-white",
        compact ? "py-12 md:py-16" : "py-24 md:py-36",
      )}
    >
      <div className="relative max-w-4xl mx-auto px-6">
        <p className="text-sm text-black text-center mb-4 tracking-wide font-light">
          {ct(content, "faq_label", "أسئلة وأجوبة")}
        </p>
        <h2 className="text-3xl md:text-[2.8rem] font-bold text-center mb-16 text-black">
          {ct(content, "faq_title", "كل ما يهمك معرفته عن Thiqa")}
        </h2>

        <div className="flex flex-col">
          {LANDING_FAQS.map((faq, i) => {
            const isOpen = openFaq === i;
            const isLast = i === LANDING_FAQS.length - 1;
            return (
              <div
                key={i}
                className={inView ? "faq-item-enter" : undefined}
                style={inView ? { animationDelay: `${120 + i * 90}ms` } : { opacity: 0 }}
              >
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
          })}
        </div>

        <p className="mt-12 text-center text-[14px] md:text-[15px] text-black/55">
          {ct(content, "faq_more_prompt", "هل لديك أسئلة إضافية؟")}{" "}
          <Link
            to="/faq#support"
            className="font-bold text-black hover:opacity-80 transition-opacity"
          >
            {ct(content, "faq_more_cta", "تواصل معنا.")}
          </Link>
        </p>
      </div>
    </section>
  );
}
