import { Mail, Phone, Facebook, Instagram } from "lucide-react";
import { DemoCallTrigger } from "./DemoCallDialog";

// Single footer used by every public-marketing surface (Landing,
// Pricing, FAQ, ContactUs). Edits here propagate everywhere — no
// more drifted copies. The CRM/dashboard surfaces do NOT use this.
//
// Shape mirrors the original Landing footer: a 4-column desktop grid
// (mobile accordion) of link sections, an LTR contact strip with
// email + phones, a dot-capped hairline, then a bottom strip with
// the copyright + social icons.

type FooterItem =
  | { label: string; href: string; demo?: false }
  | { label: string; href: ""; demo: true };

const SECTIONS: { title: string; items: FooterItem[] }[] = [
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
      { label: "كل الأدوات", href: "/landing#demo" },
      { label: "الحلول", href: "/landing#solutions" },
      { label: "لماذا ثقة", href: "/landing#features" },
      { label: "آراء العملاء", href: "/landing#testimonials" },
    ],
  },
  {
    title: "الدعم والمساعدة",
    items: [
      { label: "عرض توضيحي", href: "", demo: true },
      { label: "تواصل معنا", href: "/contact" },
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

export function PublicFooter() {
  return (
    <footer className="relative z-10 border-t border-black/[0.08] pt-16 pb-0 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        {/* Desktop 4-column grid — right-aligned Arabic. */}
        <div className="hidden md:grid grid-cols-4 gap-8 text-right">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h4 className="text-[15px] font-bold text-black mb-5">{section.title}</h4>
              <ul className="space-y-3">
                {section.items.map((item) => (
                  <li key={item.label}>
                    {item.demo ? (
                      <DemoCallTrigger className="text-[14px] text-black/60 hover:text-black transition-colors">
                        {item.label}
                      </DemoCallTrigger>
                    ) : (
                      <a
                        href={item.href}
                        className="text-[14px] text-black/60 hover:text-black transition-colors"
                      >
                        {item.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Mobile accordion — same four sections. */}
        <div className="md:hidden flex flex-col divide-y divide-black/[0.08]">
          {SECTIONS.map((section) => (
            <details key={section.title} className="group py-6">
              <summary className="flex items-center justify-between cursor-pointer list-none">
                <span className="text-lg font-bold text-black">{section.title}</span>
                <span className="text-black/55 text-2xl font-light group-open:hidden">+</span>
                <span className="text-black/55 text-2xl font-light hidden group-open:inline">−</span>
              </summary>
              <ul className="mt-4 space-y-3 text-sm text-black/60 text-right">
                {section.items.map((item) => (
                  <li key={item.label}>
                    {item.demo ? (
                      <DemoCallTrigger className="hover:text-black transition-colors">
                        {item.label}
                      </DemoCallTrigger>
                    ) : (
                      <a href={item.href} className="hover:text-black transition-colors">{item.label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>

        {/* Contact strip — email + phones, LTR so digits and email
            render in natural order regardless of the page direction. */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[14px] text-black/65" dir="ltr">
          <a href="mailto:support@getthiqa.com" className="inline-flex items-center gap-2 hover:text-black transition-colors">
            <Mail className="h-4 w-4" strokeWidth={2} aria-hidden />
            support@getthiqa.com
          </a>
          <span aria-hidden className="h-1 w-1 rounded-full bg-black/20" />
          <a href="tel:+972525143581" className="inline-flex items-center gap-2 hover:text-black transition-colors tabular-nums">
            <Phone className="h-4 w-4" strokeWidth={2} aria-hidden />
            0525143581
          </a>
          <span aria-hidden className="h-1 w-1 rounded-full bg-black/20" />
          <a href="tel:+972598948155" className="inline-flex items-center gap-2 hover:text-black transition-colors tabular-nums">
            <Phone className="h-4 w-4" strokeWidth={2} aria-hidden />
            0598 948 155
          </a>
        </div>

        <div className="flex items-center gap-3 mt-6 mb-6">
          <div className="h-1.5 w-1.5 rounded-full bg-black/25" />
          <div className="flex-1 h-px bg-black/[0.08]" />
          <div className="h-1.5 w-1.5 rounded-full bg-black/25" />
        </div>

        {/* Bottom strip — copyright on RTL start, social icons on RTL
            end. Stacks on mobile. */}
        <div className="flex flex-col-reverse md:flex-row items-center justify-between gap-6 mb-16">
          <p className="text-sm text-black/50">
            © Thiqa {new Date().getFullYear()} جميع الحقوق محفوظة
          </p>
          <div className="flex items-center gap-3">
            <a
              href="https://www.facebook.com/getthiqa"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook"
              className="h-11 w-11 rounded-full flex items-center justify-center text-white shadow-[0_6px_18px_-6px_rgba(69,94,187,0.55)] hover:opacity-90 transition-opacity"
              style={{
                background:
                  "linear-gradient(180deg, #455EBB 0%, #8A96CB 100%), rgba(255, 255, 255, 0.02)",
              }}
            >
              <Facebook className="h-[18px] w-[18px]" />
            </a>
            <a
              href="https://www.instagram.com/getthiqa"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="h-11 w-11 rounded-full flex items-center justify-center text-white shadow-[0_6px_18px_-6px_rgba(69,94,187,0.55)] hover:opacity-90 transition-opacity"
              style={{
                background:
                  "linear-gradient(180deg, #455EBB 0%, #8A96CB 100%), rgba(255, 255, 255, 0.02)",
              }}
            >
              <Instagram className="h-[18px] w-[18px]" />
            </a>
          </div>
        </div>
      </div>

      {/* Full-width Thiqa lockup image — anchors the bottom. */}
      <div className="w-full overflow-hidden">
        <img
          src="https://thiqacrm.b-cdn.net/Group%201000011511.png"
          alt="Thiqa — نظام إدارة وكالات التأمين"
          className="w-full h-auto block"
          loading="lazy"
        />
      </div>
    </footer>
  );
}
