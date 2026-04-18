import { Link } from "react-router-dom";
import { FileText, UserCheck, CreditCard, RefreshCw, Database, Ban, Wrench, AlertTriangle, ScrollText, Mail, ArrowLeft } from "lucide-react";
import { ThiqaLogoAnimation } from "@/components/shared/ThiqaLogoAnimation";
import { PublicSEO } from "@/components/public/PublicSEO";

// Public legal page — no auth, no CRM chrome. Same layout as Privacy.tsx
// so the two read as a single set.
export default function TermsOfUse() {
  return (
    <div className="min-h-screen bg-white text-foreground" dir="rtl" style={{ fontFamily: "'Cairo', sans-serif" }}>
      <PublicSEO
        title="Thiqa | شروط الاستخدام"
        description="شروط استخدام منصة Thiqa لإدارة وكالات التأمين: حقوق وواجبات المستخدم، الاشتراكات والمدفوعات، حدود المسؤولية، وسياسات الإلغاء."
        keywords="شروط استخدام Thiqa, اتفاقية الخدمة, شروط الاشتراك"
      />
      {/* Top bar */}
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
      <section
        className="relative overflow-hidden py-16 md:py-24 px-6 text-center"
        style={{
          background:
            "linear-gradient(135deg, #6b7fbc 0%, #a8b5d6 25%, #d4b8a0 55%, #9eadd4 85%, #7b93c8 100%)",
        }}
      >
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex h-20 w-20 md:h-24 md:w-24 items-center justify-center rounded-3xl bg-white/95 backdrop-blur-sm shadow-[0_18px_40px_-14px_rgba(18,32,66,0.45)] mb-6">
            <ScrollText className="h-10 w-10 md:h-12 md:w-12 text-[#122042]" strokeWidth={1.6} />
          </div>
          <p className="text-[12px] md:text-sm font-bold tracking-[0.22em] text-white/85 uppercase mb-3">
            الاتفاقية بيننا
          </p>
          <h1 className="text-3xl md:text-5xl font-extrabold text-white leading-tight mb-4">
            شروط الاستخدام
          </h1>
          <p className="text-base md:text-lg text-white/85 max-w-2xl mx-auto leading-relaxed">
            باستخدام Thiqa، أنت توافق على الشروط أدناه. كتبناها بأبسط لغة
            ممكنة كي تقرأها وتفهمها بسهولة — لا حِيَل قانونية ولا فقرات
            مخفية.
          </p>
          <p className="text-xs text-white/70 mt-5">آخر تحديث: 17 أبريل 2026</p>
        </div>
      </section>

      {/* Body */}
      <main className="max-w-3xl mx-auto px-6 py-16 md:py-20 space-y-14">

        <Section icon={<FileText className="h-5 w-5" />} number="01" title="وصف الخدمة">
          <p>
            Thiqa نظام إدارة علاقات عملاء (CRM) مصمّم خصيصاً لوكالات
            التأمين، يشمل إدارة العملاء، الوثائق، المركبات، المدفوعات،
            الشيكات، التقارير، التذكيرات، والتوقيع الرقمي عبر SMS.
            النظام يُقدَّم كخدمة سحابية (SaaS).
          </p>
        </Section>

        <Section icon={<UserCheck className="h-5 w-5" />} number="02" title="إنشاء الحساب">
          <ul>
            <li>يجب أن تكون مفوّضاً قانونياً بإنشاء حساب باسم الوكالة.</li>
            <li>المعلومات المُقدَّمة عند التسجيل يجب أن تكون صحيحة ومُحدَّثة.</li>
            <li>أنت مسؤول عن الحفاظ على سرّية كلمة المرور وعدم مشاركة حسابك مع أي شخص خارج وكالتك.</li>
            <li>أي نشاط يحدث من خلال حسابك يُعتبر صادراً عنك ما لم تُبلِّغنا عن اختراق.</li>
          </ul>
        </Section>

        <Section icon={<CreditCard className="h-5 w-5" />} number="03" title="الخطط والفترة التجريبية">
          <ul>
            <li>نقدّم <strong>35 يوم تجربة مجانية</strong> لكل وكالة جديدة، بدون بطاقة ائتمان وبدون التزام.</li>
            <li>بعد انتهاء فترة التجربة، يمكنك اختيار الخطة الأنسب لوكالتك من بين الخطط المتاحة في صفحة الأسعار.</li>
            <li>الانتقال بين الخطط المختلفة متاح في أي وقت من إعدادات الاشتراك، وفروقات السعر تُحتسب بالتناسب على الفاتورة القادمة.</li>
            <li>الفواتير شهرية أو سنوية حسب الخطّة المختارة.</li>
          </ul>
        </Section>

        <Section icon={<CreditCard className="h-5 w-5" />} number="04" title="المدفوعات والفوترة">
          <ul>
            <li>المدفوعات تتم عبر بوابة دفع آمنة (تفاصيل البطاقة لا تمر عبر خوادمنا).</li>
            <li>الفاتورة تُصدر تلقائياً في بداية كل دورة فوترة.</li>
            <li>في حال تعذّر السداد، نُرسل تنبيهاً ونُمهِلك 7 أيام قبل تعليق الحساب مؤقتاً.</li>
            <li>الحساب المُعلَّق يعود لعمله فور سداد الرسوم المستحقة، بدون أي فقدان للبيانات.</li>
          </ul>
        </Section>

        <Section icon={<RefreshCw className="h-5 w-5" />} number="05" title="الإلغاء والاسترداد">
          <ul>
            <li><strong>الإلغاء مجاني وفي أي وقت</strong> من إعدادات الحساب — بدون رسوم خروج وبدون التزام.</li>
            <li>عند الإلغاء، نُرسل لك <strong>نسخة احتياطية كاملة</strong> من قاعدة بياناتك بصيغة قياسية تحتفظ بها مدى الحياة.</li>
            <li>المبالغ المدفوعة عن فترات سابقة غير قابلة للاسترداد، لكن يبقى وصولك للنظام لنهاية الدورة المدفوعة.</li>
            <li>يمكنك إعادة تفعيل حسابك في أي وقت لاحق باستيراد النسخة الاحتياطية.</li>
          </ul>
        </Section>

        <Section icon={<Database className="h-5 w-5" />} number="06" title="ملكية البيانات">
          <ul>
            <li><strong>بياناتك ملكك بالكامل.</strong> Thiqa لا يدّعي أي ملكية على بيانات وكالتك أو عملائك.</li>
            <li>نحتفظ بحق الوصول الفنّي لأغراض التشغيل والصيانة فقط، وفق ما يوضّحه <Link to="/privacy" className="text-[#4a6cc7] hover:underline">إعلان الخصوصية</Link>.</li>
            <li><strong>لا نستخدم بياناتك</strong> لأي غرض تسويقي أو لتدريب نماذج ذكاء اصطناعي خارجية.</li>
            <li>تستطيع تصدير كل بياناتك بصيغة Excel/CSV من داخل النظام في أي وقت.</li>
          </ul>
        </Section>

        <Section icon={<Ban className="h-5 w-5" />} number="07" title="الاستخدام المقبول">
          <p>يُحظر استخدام Thiqa لأي مما يلي:</p>
          <ul>
            <li>أي نشاط غير قانوني أو يخالف اللوائح المحلية.</li>
            <li>إرسال رسائل غير مرغوب فيها (سبام) أو محتوى مضر/مسيء.</li>
            <li>محاولة اختراق النظام، استخراج البيانات بطرق غير مصرّحة، أو الالتفاف على نظام الصلاحيات.</li>
            <li>إعادة بيع الخدمة، السماح لأطراف خارج وكالتك باستخدام حسابك، أو تقديمها كخدمة باسم آخر.</li>
            <li>تحميل ملفات تحتوي على فيروسات أو برمجيات خبيثة.</li>
          </ul>
          <p>
            مخالفة هذه البنود قد تؤدي إلى تعليق فوري للحساب دون استرداد.
          </p>
        </Section>

        <Section icon={<Wrench className="h-5 w-5" />} number="08" title="الإتاحة والصيانة">
          <ul>
            <li>نسعى لإتاحة النظام على مدار 24/7. مستوى الخدمة المُستهدَف هو 99.5% شهرياً.</li>
            <li>الصيانة المخطّط لها تتم عادة في ساعات الذروة المنخفضة، ونُعلِم بها مسبقاً عبر البريد.</li>
            <li>الأعطال الطارئة قد تؤدي إلى فترات توقّف قصيرة. نلتزم بإصلاحها بأسرع وقت ممكن.</li>
          </ul>
        </Section>

        <Section icon={<AlertTriangle className="h-5 w-5" />} number="09" title="حدود المسؤولية">
          <ul>
            <li>Thiqa مُقدَّم "كما هو" (as-is) — ندعم الجودة والاستقرار بأقصى جهدنا، لكن لا نضمن خلوّه من أي خطأ مطلقاً.</li>
            <li>أنت مسؤول عن صحّة البيانات التي تُدخلها وعن استخدامها وفق الأنظمة المحلية للتأمين.</li>
            <li>مسؤوليتنا المالية الإجمالية محدودة بالمبلغ الذي دفعته للنظام خلال آخر 12 شهراً.</li>
            <li>لا نتحمّل المسؤولية عن خسائر تجارية غير مباشرة (فوات أرباح، فقدان عملاء بسبب خطأ بشري في الإدخال).</li>
          </ul>
        </Section>

        <Section icon={<RefreshCw className="h-5 w-5" />} number="10" title="تعديل الشروط">
          <p>
            قد نُحدّث هذه الشروط من وقت لآخر لعكس تطوّر النظام أو متطلبات
            قانونية جديدة. التعديلات الجوهرية يتم إخطارك بها عبر البريد
            قبل دخولها حيّز التنفيذ بـ <strong>14 يوماً</strong> على الأقل.
            استمرارك في استخدام Thiqa بعد التحديث يُعتبر قبولاً للشروط
            المُحدَّثة.
          </p>
        </Section>

        <Section icon={<ScrollText className="h-5 w-5" />} number="11" title="القانون المعمول به">
          <p>
            تخضع هذه الشروط لقوانين دولة إسرائيل. أي نزاع لا يمكن حلّه
            وُدّياً يُحال إلى المحاكم المختصة في حيفا.
          </p>
        </Section>

        <Section icon={<Mail className="h-5 w-5" />} number="12" title="تواصل معنا">
          <ul>
            <li>الدعم العام: <a href="mailto:support@getthiqa.com" className="text-[#4a6cc7] hover:underline" dir="ltr">support@getthiqa.com</a></li>
          </ul>
        </Section>

      </main>

      {/* Footer */}
      <footer className="border-t border-black/[0.06] py-8 px-6 text-center text-sm text-black/55">
        <div className="flex items-center justify-center gap-4">
          <Link to="/privacy" className="hover:text-black transition-colors">سياسة الخصوصية</Link>
          <span className="opacity-40">|</span>
          <Link to="/" className="hover:text-black transition-colors">الرئيسية</Link>
        </div>
        <p className="mt-4">جميع الحقوق محفوظة © Thiqa {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}

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
      <div className="text-[14px] md:text-[15px] text-black/70 leading-[1.85] space-y-3 [&_ul]:space-y-2 [&_ul]:list-disc [&_ul]:pr-6 [&_strong]:text-black">
        {children}
      </div>
    </section>
  );
}
