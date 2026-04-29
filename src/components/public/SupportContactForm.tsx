import { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Mail, Clock, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { FAQ_CATEGORIES } from "@/lib/faqContent";
import { RichTextEditor } from "./RichTextEditor";

// Per-field validation. Lives client-side AND server-side; the server
// is authoritative, the client just gives instant feedback.
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

interface FormErrors {
  name?: string;
  email?: string;
  category?: string;
  body?: string;
}

interface SupportContactFormProps {
  className?: string;
}

// Used by `<FAQ />` as the trailing section. Anchored at #support so
// the nav's "تواصل معنا" link can scroll directly here.
export function SupportContactForm({ className }: SupportContactFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyText, setBodyText] = useState("");
  // Honeypot — bots tend to autofill every field. Real users never
  // see this input (visually hidden + tabindex=-1) so a non-empty
  // value is a strong signal we should silently drop the request.
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ ticketNumber: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedBody = bodyText.trim();

    if (trimmedName.length < 2) next.name = "الاسم قصير جداً";
    else if (trimmedName.length > 120) next.name = "الاسم طويل جداً";

    if (!trimmedEmail) next.email = "البريد الإلكتروني مطلوب";
    else if (!EMAIL_RE.test(trimmedEmail)) next.email = "صيغة البريد غير صحيحة";

    if (!category) next.category = "اختر فئة الطلب";

    if (!trimmedBody) next.body = "تفاصيل الطلب مطلوبة";
    else if (trimmedBody.length > 5000) next.body = "النص طويل جداً (الحد 5000 حرف)";

    return next;
  };

  // Re-validate the field that changed so the error clears as the
  // user types — prevents a stale "required" error sticking after
  // they fill the field in.
  const validateField = (field: keyof FormErrors) => {
    const next = validate();
    setErrors((prev) => ({ ...prev, [field]: next[field] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await supabase.functions.invoke("public-support-submit", {
        body: {
          name: name.trim(),
          email: email.trim(),
          category,
          body: bodyText.trim(),
          body_html: bodyHtml,
          honeypot,
        },
      });
      if (error) throw error;
      const result = data as { ok: boolean; ticket_number?: string; error?: string };
      if (!result.ok || !result.ticket_number) {
        throw new Error(result.error || "submit_failed");
      }
      setSubmitted({ ticketNumber: result.ticket_number });
      setName("");
      setEmail("");
      setCategory("");
      setBodyHtml("");
      setBodyText("");
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      setSubmitError(messageForError(code));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div
        id="support"
        className={cn(
          "relative max-w-2xl mx-auto px-6 md:px-12 pt-12 md:pt-14 pb-10 md:pb-12 rounded-3xl bg-white border border-black/[0.06] shadow-[0_24px_60px_-28px_rgba(15,40,120,0.22)] text-center overflow-hidden",
          className,
        )}
        role="status"
        aria-live="polite"
      >
        {/* Soft brand-purple top accent — same hue as the pricing
            hero gradient, so the success card visually belongs to
            the same product surface. */}
        <div
          aria-hidden
          className="absolute top-0 inset-x-0 h-32 pointer-events-none"
          style={{
            background:
              "radial-gradient(60% 100% at 50% 0%, rgba(124,92,255,0.10) 0%, rgba(124,92,255,0) 70%)",
          }}
        />

        <div className="relative">
          {/* Success badge — gradient pill with a soft halo behind. */}
          <div className="relative inline-flex items-center justify-center mb-6">
            <span aria-hidden className="absolute inset-0 rounded-full bg-emerald-200/50 blur-2xl" />
            <span className="relative inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100 ring-1 ring-emerald-200/70">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" strokeWidth={2.2} />
            </span>
          </div>

          <h3 className="text-[26px] md:text-[28px] font-bold text-black tracking-tight mb-2.5">
            شكراً لتواصلك معنا
          </h3>
          <p className="text-[14.5px] md:text-[15px] text-black/55 leading-relaxed mb-8 max-w-md mx-auto">
            استلمنا طلبك بنجاح وسنرد عليك على بريدك الإلكتروني في أقرب وقت ممكن.
          </p>

          {/* Ticket number — solid black card, the one element a user
              might want to copy/screenshot, so it's the visual anchor. */}
          <div className="inline-flex flex-col items-center gap-1.5 px-7 md:px-9 py-4 md:py-5 rounded-2xl bg-black text-white mb-8">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-white/55">
              رقم التذكرة
            </span>
            <span
              className="text-[20px] md:text-[22px] font-extrabold tabular-nums tracking-wider"
              dir="ltr"
            >
              {submitted.ticketNumber}
            </span>
          </div>

          {/* Two-tile "what happens next" — keeps the card from
              feeling empty and answers the obvious questions
              ("when?" / "how?") without a wall of text. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md mx-auto mb-8 text-right">
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-black/[0.025] border border-black/[0.04]">
              <span className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-white border border-black/[0.06] text-black shrink-0">
                <Mail className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-bold text-black leading-tight mb-0.5">رد على بريدك</p>
                <p className="text-[11.5px] text-black/50 leading-snug">
                  سيصلك الرد على نفس البريد المُدخل
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-black/[0.025] border border-black/[0.04]">
              <span className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-white border border-black/[0.06] text-black shrink-0">
                <Clock className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-bold text-black leading-tight mb-0.5">خلال 24 ساعة</p>
                <p className="text-[11.5px] text-black/50 leading-snug">
                  في أيام العمل — الأحد إلى الخميس
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSubmitted(null)}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-[13px] font-bold text-black hover:bg-black/[0.05] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
            إرسال طلب آخر
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      id="support"
      onSubmit={handleSubmit}
      className={cn("max-w-2xl mx-auto", className)}
      noValidate
    >
      {/* Honeypot — visually hidden but technically present in the
          DOM so naïve form-fillers/bots populate it. */}
      <div
        style={{ position: "absolute", left: "-9999px", top: "-9999px" }}
        aria-hidden="true"
      >
        <label>
          لا تملأ هذا الحقل
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>

      <div className="text-center mb-8">
        <p className="text-sm text-black/55 mb-3 tracking-wide">تواصل معنا</p>
        <h2 className="text-2xl md:text-3xl font-bold text-black mb-2">لم تجد إجابتك؟ راسلنا مباشرة</h2>
        <p className="text-[14px] md:text-[15px] text-black/55 leading-relaxed max-w-md mx-auto">
          سنرد على بريدك الإلكتروني في أقرب وقت ممكن. كل التذاكر تدخل نظام الدعم لدينا ونتابعها يدوياً.
        </p>
      </div>

      <div className="space-y-5">
        {/* Name */}
        <div>
          <label htmlFor="support-name" className="block text-[13px] font-semibold text-black mb-1.5">
            الاسم الكامل <span className="text-red-500">*</span>
          </label>
          <input
            id="support-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) validateField("name");
            }}
            onBlur={() => validateField("name")}
            placeholder="مثال: أحمد محمد"
            autoComplete="name"
            disabled={submitting}
            aria-invalid={!!errors.name || undefined}
            aria-describedby={errors.name ? "support-name-error" : undefined}
            className={cn(
              "w-full h-12 px-4 rounded-xl text-[15px] text-black bg-white border transition-colors outline-none placeholder:text-black/30",
              errors.name
                ? "border-red-300 focus:border-red-400"
                : "border-black/15 focus:border-black/40",
            )}
          />
          {errors.name && (
            <p id="support-name-error" className="mt-1.5 text-[12px] text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.name}
            </p>
          )}
        </div>

        {/* Email */}
        <div>
          <label htmlFor="support-email" className="block text-[13px] font-semibold text-black mb-1.5">
            البريد الإلكتروني <span className="text-red-500">*</span>
          </label>
          <input
            id="support-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) validateField("email");
            }}
            onBlur={() => validateField("email")}
            placeholder="example@email.com"
            autoComplete="email"
            disabled={submitting}
            dir="ltr"
            aria-invalid={!!errors.email || undefined}
            aria-describedby={errors.email ? "support-email-error" : undefined}
            className={cn(
              "w-full h-12 px-4 rounded-xl text-[15px] text-black bg-white border transition-colors outline-none placeholder:text-black/30 text-right",
              errors.email
                ? "border-red-300 focus:border-red-400"
                : "border-black/15 focus:border-black/40",
            )}
          />
          {errors.email && (
            <p id="support-email-error" className="mt-1.5 text-[12px] text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.email}
            </p>
          )}
        </div>

        {/* Category */}
        <div>
          <label htmlFor="support-category" className="block text-[13px] font-semibold text-black mb-1.5">
            فئة الطلب <span className="text-red-500">*</span>
          </label>
          <select
            id="support-category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              if (errors.category) validateField("category");
            }}
            onBlur={() => validateField("category")}
            disabled={submitting}
            aria-invalid={!!errors.category || undefined}
            aria-describedby={errors.category ? "support-category-error" : undefined}
            className={cn(
              "w-full h-12 px-4 rounded-xl text-[15px] text-black bg-white border transition-colors outline-none",
              errors.category
                ? "border-red-300 focus:border-red-400"
                : "border-black/15 focus:border-black/40",
            )}
          >
            <option value="" disabled>اختر فئة الطلب…</option>
            {FAQ_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.label}>{cat.label}</option>
            ))}
            <option value="أخرى">أخرى</option>
          </select>
          {errors.category && (
            <p id="support-category-error" className="mt-1.5 text-[12px] text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.category}
            </p>
          )}
        </div>

        {/* Body — visual editor */}
        <div>
          <label className="block text-[13px] font-semibold text-black mb-1.5">
            تفاصيل الطلب <span className="text-red-500">*</span>
          </label>
          <RichTextEditor
            value={bodyHtml}
            onChange={(html, text) => {
              setBodyHtml(html);
              setBodyText(text);
              if (errors.body) validateField("body");
            }}
            placeholder="اشرح طلبك بالتفصيل…"
            invalid={!!errors.body}
            ariaLabel="تفاصيل طلب الدعم"
          />
          {errors.body && (
            <p className="mt-1.5 text-[12px] text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.body}
            </p>
          )}
        </div>

        {/* Submit error banner */}
        {submitError && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13.5px] text-red-700 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {/* Submit */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-full bg-black text-white text-[14px] font-bold transition-all hover:bg-black/85 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري الإرسال…
              </>
            ) : (
              "إرسال الطلب"
            )}
          </button>
          <p className="mt-3 text-[12px] text-black/45 text-center leading-relaxed">
            بإرسالك هذا الطلب فأنت توافق على تواصلنا معك على البريد الإلكتروني المُدخل. لا نشارك بياناتك مع أي طرف ثالث.
          </p>
        </div>
      </div>
    </form>
  );
}

function messageForError(code: string): string {
  switch (code) {
    case "rate_limited":
      return "أرسلت عدداً كبيراً من الطلبات في وقت قصير. حاول مرة أخرى بعد قليل.";
    case "invalid_email":
      return "البريد الإلكتروني غير صالح.";
    case "invalid_name":
      return "الاسم غير صالح.";
    case "invalid_category":
      return "الرجاء اختيار فئة صحيحة.";
    case "invalid_body":
      return "تفاصيل الطلب مطلوبة (الحد الأقصى 5000 حرف).";
    case "ticket_insert_failed":
    case "submit_failed":
      return "حدث خطأ أثناء إرسال الطلب. حاول مرة أخرى أو راسلنا على support@getthiqa.com.";
    default:
      return "حدث خطأ غير متوقع. حاول مرة أخرى.";
  }
}
