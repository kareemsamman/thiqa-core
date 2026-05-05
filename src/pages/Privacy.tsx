import { Link } from "react-router-dom";
import { ShieldCheck, Lock, Database, Users, Share2, Download, Cookie, RefreshCw, Mail, ArrowLeft } from "lucide-react";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
import { PublicSEO } from "@/components/public/PublicSEO";
import { WebPageJsonLd } from "@/components/public/PublicJsonLd";

// Public legal page — no auth, no CRM chrome. Reads as a plain
// document with a calm hero + numbered sections. Layout mirrors
// TermsOfUse.tsx so the two pages feel like one set.
export default function Privacy() {
  return (
    <div className="min-h-screen bg-white text-foreground public-page-enter" dir="rtl" style={{ fontFamily: "'Cairo', sans-serif" }}>
      <PublicSEO
        title="سياسة الخصوصية Thiqa — حماية بيانات وكالات التأمين"
        description="سياسة الخصوصية لمنصة Thiqa: كيف نجمع، نستخدم، ونحمي بيانات وكالات التأمين وعملائها وفقاً للمعايير الدولية."
        keywords="سياسة خصوصية Thiqa, حماية البيانات, خصوصية التأمين, GDPR, ثقة"
      />
      <WebPageJsonLd
        name="سياسة الخصوصية — Thiqa"
        pathname="/privacy"
        description="سياسة خصوصية Thiqa لحماية بيانات وكالات التأمين."
      />
      {/* Top bar — Thiqa logo on the right, simple back link on the left. */}
      <header className="border-b border-black/[0.06]">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center text-black">
            <ThiqaLogoAnimation
              iconSize={28}
              interactive={false}
              iconSrc="https://thiqacrm.b-cdn.net/small_black.png"
            />
          </Link>
          <Link to="/" className="text-sm text-black/60 hover:text-black transition-colors flex items-center gap-1.5">
            العودة للرئيسية
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-white">
        <div className="max-w-3xl mx-auto px-6 pt-16 pb-12 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/5 mb-6">
            <ShieldCheck className="h-6 w-6 text-black" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-black mb-3 tracking-tight">سياسة الخصوصية</h1>
          <p className="text-base md:text-lg text-black/60 leading-relaxed">
            نحن في Thiqa نأخذ خصوصيتك على محمل الجد. هذه السياسة تشرح كيف نجمع المعلومات ونستخدمها ونحميها.
          </p>
          <p className="text-xs text-black/40 mt-4">آخر تحديث: 1 يناير 2026</p>
        </div>
      </section>

      {/* Sections */}
      <main className="max-w-3xl mx-auto px-6 pb-24 space-y-12">
        <Section icon={<Lock className="h-5 w-5" />} title="1. المعلومات التي نجمعها">
          <p>نجمع المعلومات التي تقدمها مباشرة عند إنشاء حساب أو استخدام خدماتنا، مثل الاسم، البريد الإلكتروني، رقم الهاتف، واسم الوكالة. كما نجمع تلقائياً معلومات تقنية مثل عنوان IP، نوع المتصفح، نظام التشغيل، وتاريخ ووقت الاستخدام لأغراض التحليل والأمن.</p>
        </Section>

        <Section icon={<Database className="h-5 w-5" />} title="2. كيف نستخدم معلوماتك">
          <ul className="list-disc pr-5 space-y-2">
            <li>تقديم وتحسين خدماتنا</li>
            <li>إرسال إشعارات حول حسابك واشتراكك</li>
            <li>الرد على استفساراتك وطلبات الدعم</li>
            <li>إرسال تحديثات أمنية وتنبيهات النظام</li>
            <li>تحليل الاستخدام لتحسين تجربة المستخدم</li>
            <li>الامتثال للالتزامات القانونية</li>
          </ul>
        </Section>

        <Section icon={<Users className="h-5 w-5" />} title="3. مشاركة المعلومات">
          <p>لا نبيع معلوماتك الشخصية. قد نشاركها فقط في الحالات التالية: مع موفري الخدمات الذين يساعدوننا في تشغيل المنصة، عند الطلب القانوني من الجهات المختصة، أو لحماية حقوقنا وحقوق مستخدمينا.</p>
        </Section>

        <Section icon={<Share2 className="h-5 w-5" />} title="4. أمن البيانات">
          <p>نستخدم تقنيات تشفير حديثة لحماية بياناتك. جميع الاتصالات بين متصفحك وخوادمنا مشفرة عبر HTTPS. كلمات المرور مخزنة بصيغة مشفرة ولا يمكن استرجاعها. نقوم بنسخ احتياطي يومي للبيانات لضمان عدم فقدانها.</p>
        </Section>

        <Section icon={<Download className="h-5 w-5" />} title="5. حقوقك">
          <ul className="list-disc pr-5 space-y-2">
            <li>الوصول إلى بياناتك في أي وقت</li>
            <li>تصحيح أي معلومات غير دقيقة</li>
            <li>طلب حذف حسابك وبياناتك</li>
            <li>تصدير بياناتك بصيغة قابلة للقراءة</li>
            <li>سحب موافقتك على معالجة البيانات</li>
          </ul>
        </Section>

        <Section icon={<Cookie className="h-5 w-5" />} title="6. ملفات تعريف الارتباط">
          <p>نستخدم ملفات تعريف الارتباط (cookies) لتحسين تجربتك. تشمل هذه: ملفات أساسية لتسجيل الدخول والأمان، ملفات وظيفية لحفظ تفضيلاتك، وملفات تحليلية لفهم كيفية استخدام المنصة. يمكنك إدارة إعدادات الكوكيز من متصفحك.</p>
        </Section>

        <Section icon={<RefreshCw className="h-5 w-5" />} title="7. التحديثات على هذه السياسة">
          <p>قد نقوم بتحديث سياسة الخصوصية من وقت لآخر. عند إجراء تغييرات جوهرية، سنعلمك عبر البريد الإلكتروني أو من خلال إشعار داخل المنصة. استمرارك في استخدام خدماتنا بعد التحديث يعتبر موافقة على السياسة الجديدة.</p>
        </Section>

        <Section icon={<Mail className="h-5 w-5" />} title="8. تواصل معنا">
          <p>إذا كان لديك أي أسئلة حول سياسة الخصوصية أو ممارساتنا في حماية البيانات، يمكنك التواصل معنا عبر البريد الإلكتروني: <a href="mailto:support@getthiqa.com" className="font-semibold text-black underline underline-offset-2">support@getthiqa.com</a></p>
        </Section>
      </main>

      {/* Footer */}
      <footer className="border-t border-black/[0.06] bg-white">
        <div className="max-w-5xl mx-auto px-6 py-8 text-center text-sm text-black/50">
          <p>{`جميع الحقوق محفوظة © Thiqa ${new Date().getFullYear()}`}</p>
        </div>
      </footer>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-black">
          {icon}
        </div>
        <h2 className="text-xl md:text-2xl font-bold text-black">{title}</h2>
      </div>
      <div className="text-base text-black/70 leading-relaxed pr-12">{children}</div>
    </section>
  );
}
