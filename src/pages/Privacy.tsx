import { Link } from "react-router-dom";
import { ShieldCheck, Lock, Database, Users, Share2, Download, Cookie, RefreshCw, Mail, ArrowLeft } from "lucide-react";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
import { PublicSEO } from "@/components/public/PublicSEO";

// Public legal page — no auth, no CRM chrome. Reads as a plain
// document with a calm hero + numbered sections. Layout mirrors
// TermsOfUse.tsx so the two pages feel like one set.
export default function Privacy() {
  return (
    <div className="min-h-screen bg-white text-foreground" dir="rtl" style={{ fontFamily: "'Cairo', sans-serif" }}>
      <PublicSEO
        title="Thiqa | سياسة الخصوصية"
        description="سياسة خصوصية Thiqa: كيف نجمع بياناتك ونحميها ونستخدمها داخل نظام إدارة وكالات التأمين، وحقوقك في الوصول والتحكم بهذه البيانات."
        keywords="سياسة خصوصية Thiqa, حماية البيانات, خصوصية التأمين, GDPR"
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

      {/* Hero — soft brand gradient, big shield icon, title + subtitle. */}
      <section
        className="relative overflow-hidden py-16 md:py-24 px-6 text-center"
        style={{
          background:
            "linear-gradient(135deg, #6b7fbc 0%, #a8b5d6 25%, #d4b8a0 55%, #9eadd4 85%, #7b93c8 100%)",
        }}
      >
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex h-20 w-20 md:h-24 md:w-24 items-center justify-center rounded-3xl bg-white/95 backdrop-blur-sm shadow-[0_18px_40px_-14px_rgba(18,32,66,0.45)] mb-6">
            <ShieldCheck className="h-10 w-10 md:h-12 md:w-12 text-[#122042]" strokeWidth={1.6} />
          </div>
          <p className="text-[12px] md:text-sm font-bold tracking-[0.22em] text-white/85 uppercase mb-3">
            خصوصيتك، أولويتنا
          </p>
          <h1 className="text-3xl md:text-5xl font-extrabold text-white leading-tight mb-4">
            سياسة الخصوصية
          </h1>
          <p className="text-base md:text-lg text-white/85 max-w-2xl mx-auto leading-relaxed">
            نأخذ خصوصية وكالتك وعملائك على محمل الجد. هذه الصفحة تشرح بالتفصيل
            ما البيانات التي نجمعها، كيف نخزّنها ونحميها، ومن يصل إليها.
          </p>
          <p className="text-xs text-white/70 mt-5">آخر تحديث: 17 أبريل 2026</p>
        </div>
      </section>

      {/* Body — numbered sections with side icons. */}
      <main className="max-w-3xl mx-auto px-6 py-16 md:py-20 space-y-14">

        <Section
          icon={<Database className="h-5 w-5" />}
          number="01"
          title="ما البيانات التي نجمعها"
        >
          <p>
            Thiqa هو نظام إدارة علاقات عملاء (CRM) لوكالات التأمين، لذا فإن
            معظم البيانات داخل النظام يُدخِلها وكلاؤك يدوياً أو عبر استيراد
            من ملفات. نقوم بجمع:
          </p>
          <ul>
            <li><strong>بيانات الحساب:</strong> الاسم، البريد الإلكتروني، رقم الهاتف، اسم وكالتك.</li>
            <li><strong>بيانات وكالتك:</strong> سجلات العملاء (اسم، هوية، تواصل)، الوثائق التأمينية، المركبات، المدفوعات، الشيكات، العمولات، الموظفون والصلاحيات.</li>
            <li><strong>بيانات الاستخدام:</strong> سجلات تسجيل الدخول، النشاط داخل النظام (لأغراض الأمن والمراجعة)، عناوين IP، نوع المتصفح.</li>
            <li><strong>المراسلات:</strong> رسائل SMS التي ترسلها لعملائك عبر النظام (نحتفظ بنص الرسالة + رقم المستلم لأغراض السجل).</li>
          </ul>
        </Section>

        <Section
          icon={<Lock className="h-5 w-5" />}
          number="02"
          title="كيف نخزّن ونحمي البيانات"
        >
          <ul>
            <li>
              <strong>تشفير في حالة السكون:</strong> جميع البيانات في قواعد
              بياناتنا مشفّرة على مستوى التخزين (AES-256) بواسطة موفّر البنية
              التحتية السحابية.
            </li>
            <li>
              <strong>تجزئة كلمات المرور:</strong> كلمات المرور لا تُحفظ بنصّها
              الأصلي أبداً. نستخدم خوارزمية <code>bcrypt</code> القياسية صناعياً
              لتجزئتها (hashing) قبل التخزين، مما يعني أن لا أحد — لا حتى فريقنا
              التقني — يستطيع قراءة كلمة مرورك.
            </li>
            <li>
              <strong>التشفير أثناء النقل:</strong> كل اتصال بين متصفحك
              وخوادمنا يتم عبر HTTPS/TLS 1.3 حصراً.
            </li>
            <li>
              <strong>نسخ احتياطية يومية:</strong> نقوم تلقائياً بأخذ نسخة
              احتياطية كاملة من قاعدة بيانات وكالتك يومياً، ونحتفظ بها لمدة
              30 يوماً متجدّدة.
            </li>
            <li>
              <strong>سجل النشاط:</strong> يتم تسجيل كل عملية حساسة (تسجيل دخول،
              تعديل بيانات عميل، حذف وثيقة) في سجل قابل للمراجعة من قبل مدير
              الوكالة.
            </li>
          </ul>
        </Section>

        <Section
          icon={<Users className="h-5 w-5" />}
          number="03"
          title="من يستطيع الوصول إلى بياناتك"
        >
          <ul>
            <li>
              <strong>أنت ومستخدمو وكالتك فقط:</strong> صلاحيات الوصول داخل
              وكالتك تحت سيطرتك بالكامل عبر نظام صلاحيات دقيق (لكل دور:
              مدير، وكيل، محاسب، موظف استقبال).
            </li>
            <li>
              <strong>فريق الدعم التقني لـ Thiqa:</strong> لا يصل إلى محتوى
              بياناتك إلا بإذن صريح منك ولأغراض حل مشكلة محددة، وكل وصول
              يتم تسجيله في سجل مراجعة داخلي.
            </li>
            <li>
              <strong>لا نبيع ولا نشارك بياناتك:</strong> نحن لا نبيع بيانات
              وكالتك أو عملائك لأي طرف ثالث، تحت أي ظرف.
            </li>
          </ul>
        </Section>

        <Section
          icon={<Share2 className="h-5 w-5" />}
          number="04"
          title="مشاركة البيانات مع موفّري خدمات"
        >
          <p>
            لتشغيل بعض الميزات، نعتمد على موفّري خدمات خارجيين موثوقين.
            نشارك معهم الحدّ الأدنى الضروري من البيانات فقط:
          </p>
          <ul>
            <li><strong>مزوّد SMS:</strong> رقم الهاتف ونص الرسالة فقط، عند إرسال تذكير أو رابط توقيع لعميل.</li>
            <li><strong>بوابات الدفع (Tranzila وغيرها):</strong> تفاصيل البطاقة لا تمر عبر خوادمنا أبداً — يتم إدخالها مباشرة على بوابة الدفع.</li>
            <li><strong>Google OAuth:</strong> فقط إذا اخترت تسجيل الدخول بحساب Google. نتلقّى بريدك واسمك، لا شيء آخر.</li>
            <li><strong>موفّرو البنية التحتية السحابية:</strong> نحتفظ بعقود معالجة بيانات (DPA) معهم تلزمهم بنفس معايير الخصوصية.</li>
          </ul>
        </Section>

        <Section
          icon={<Download className="h-5 w-5" />}
          number="05"
          title="حقوقك في بياناتك"
        >
          <ul>
            <li>
              <strong>حق الاطلاع:</strong> يمكنك في أي وقت رؤية كل البيانات
              المخزّنة في حسابك من داخل النظام.
            </li>
            <li>
              <strong>حق التصدير:</strong> صدّر جميع بياناتك (عملاء، وثائق،
              مدفوعات، تقارير) بصيغة Excel/CSV من زر التصدير في كل قسم.
            </li>
            <li>
              <strong>نسخة احتياطية عند الإلغاء:</strong> عند إلغاء اشتراكك،
              نرسل لك نسخة احتياطية كاملة من قاعدة بياناتك بصيغة قياسية
              تحتفظ بها مدى الحياة.
            </li>
            <li>
              <strong>حق الحذف الدائم:</strong> يمكنك طلب حذف حسابك وجميع
              بياناته بشكل دائم. يتم خلال 30 يوماً من تاريخ الطلب (مدة
              الاحتفاظ القانونية بسجلات الفوترة).
            </li>
          </ul>
        </Section>

        <Section
          icon={<Cookie className="h-5 w-5" />}
          number="06"
          title="ملفات تعريف الارتباط (Cookies)"
        >
          <p>
            نستخدم نوعين من ملفات تعريف الارتباط:
          </p>
          <ul>
            <li><strong>تشغيلية:</strong> للحفاظ على جلستك مفتوحة وحفظ تفضيلاتك (لغة، عرض جدول، فرع نشط). هذه ضرورية للنظام ولا يمكن تعطيلها.</li>
            <li><strong>تحليلية:</strong> لفهم استخدامك للنظام وتحسينه (أي شاشات الأكثر استخداماً، أين تواجه مشاكل). يمكنك تعطيلها من إعدادات حسابك.</li>
          </ul>
        </Section>

        <Section
          icon={<RefreshCw className="h-5 w-5" />}
          number="07"
          title="تغييرات على هذه السياسة"
        >
          <p>
            قد نُحدّث هذه السياسة من وقت لآخر. أي تغيير جوهري سنُبلّغك به
            عبر بريدك الإلكتروني قبل دخوله حيّز التنفيذ بـ 14 يوماً على
            الأقل. الاستمرار في استخدام Thiqa بعد دخول التحديث يُعتبر
            قبولاً للسياسة المُحدَّثة.
          </p>
        </Section>

        <Section
          icon={<Mail className="h-5 w-5" />}
          number="08"
          title="تواصل معنا"
        >
          <p>
            لأي استفسار يخصّ خصوصيتك أو لطلب الوصول إلى بياناتك أو حذفها:
          </p>
          <ul>
            <li>الدعم العام: <a href="mailto:support@getthiqa.com" className="text-[#4a6cc7] hover:underline" dir="ltr">support@getthiqa.com</a></li>
          </ul>
          <p>
            نلتزم بالردّ خلال 5 أيام عمل كحد أقصى.
          </p>
        </Section>

      </main>

      {/* Footer */}
      <footer className="border-t border-black/[0.06] py-8 px-6 text-center text-sm text-black/55">
        <div className="flex items-center justify-center gap-4">
          <Link to="/terms" className="hover:text-black transition-colors">شروط الاستخدام</Link>
          <span className="opacity-40">|</span>
          <Link to="/" className="hover:text-black transition-colors">الرئيسية</Link>
        </div>
        <p className="mt-4">جميع الحقوق محفوظة © Thiqa {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}

// Reusable section block — number + icon row, title, then prose body
// inheriting consistent typography. Same component used in TermsOfUse.
function Section({
  icon,
  number,
  title,
  children,
}: {
  icon: React.ReactNode;
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#f2f3f6] text-[#122042] flex-shrink-0">
          {icon}
        </span>
        <span className="text-[11px] font-bold tracking-[0.18em] text-[#4a6cc7]">{number}</span>
        <h2 className="text-xl md:text-2xl font-extrabold text-black leading-tight">
          {title}
        </h2>
      </div>
      <div className="text-[14px] md:text-[15px] text-black/70 leading-[1.85] space-y-3 [&_ul]:space-y-2 [&_ul]:list-disc [&_ul]:pr-6 [&_strong]:text-black [&_code]:bg-black/[0.06] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px]">
        {children}
      </div>
    </section>
  );
}
