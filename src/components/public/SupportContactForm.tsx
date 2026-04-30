import { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Mail, Clock, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { FAQ_CATEGORIES } from "@/lib/faqContent";

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

  // Strain-style card: rounded-3xl + soft border + drop shadow. Two
  // columns for name+email on desktop, stacked on mobile. Pill inputs
  // sit on a faint grey track so the white card stays the visual
  // surface and the fields read as inset chips rather than competing
  // outlined controls. Body is a plain textarea — no rich-text editor.
  return (
    <form
      id="support"
      onSubmit={handleSubmit}
      className={cn(
        "relative max-w-2xl mx-auto bg-white border border-black/[0.06] rounded-[28px]",
        "shadow-[0_30px_80px_-30px_rgba(15,40,120,0.18)]",
        "px-6 md:px-10 py-8 md:py-10",
        className,
      )}
      noValidate
    >
      {/* Honeypot — visually hidden but in the DOM. */}
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

      <div className="mb-7 text-right">
        <h2 className="text-[24px] md:text-[28px] font-bold text-black leading-tight mb-1.5">
          إرسال طلب
        </h2>
        <p className="text-[13.5px] md:text-[14px] text-black/55 leading-relaxed">
          أرسل لنا رسالة وسنرد عليك في أقرب وقت ممكن.
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FieldShell
            id="support-name"
            label="الاسم الكامل"
            error={errors.name}
          >
            <input
              id="support-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) validateField("name");
              }}
              onBlur={() => validateField("name")}
              placeholder="الاسم الكامل"
              autoComplete="name"
              disabled={submitting}
              aria-invalid={!!errors.name || undefined}
              aria-describedby={errors.name ? "support-name-error" : undefined}
              className={pillInputClass(!!errors.name)}
            />
          </FieldShell>

          <FieldShell
            id="support-email"
            label="البريد الإلكتروني"
            error={errors.email}
          >
            <input
              id="support-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) validateField("email");
              }}
              onBlur={() => validateField("email")}
              placeholder="email@example.com"
              autoComplete="email"
              disabled={submitting}
              dir="ltr"
              aria-invalid={!!errors.email || undefined}
              aria-describedby={errors.email ? "support-email-error" : undefined}
              className={cn(pillInputClass(!!errors.email), "text-left")}
            />
          </FieldShell>
        </div>

        <FieldShell
          id="support-category"
          label="فئة الطلب"
          error={errors.category}
        >
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
            className={pillInputClass(!!errors.category)}
          >
            <option value="" disabled>اختر فئة الطلب…</option>
            {FAQ_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.label}>{cat.label}</option>
            ))}
            <option value="أخرى">أخرى</option>
          </select>
        </FieldShell>

        <FieldShell
          id="support-body"
          label="تفاصيل الطلب"
          error={errors.body}
        >
          <textarea
            id="support-body"
            value={bodyText}
            onChange={(e) => {
              setBodyText(e.target.value);
              if (errors.body) validateField("body");
            }}
            onBlur={() => validateField("body")}
            placeholder="اكتب رسالتك..."
            disabled={submitting}
            rows={5}
            aria-invalid={!!errors.body || undefined}
            aria-describedby={errors.body ? "support-body-error" : undefined}
            className={cn(
              "w-full px-5 py-4 rounded-2xl text-[15px] text-black bg-black/[0.04] border outline-none transition-colors placeholder:text-black/35 resize-y min-h-[120px]",
              errors.body
                ? "border-rose-300 focus:bg-white focus:border-rose-400"
                : "border-transparent focus:bg-white focus:border-black/20",
            )}
          />
        </FieldShell>

        {submitError && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-[13.5px] text-rose-700 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

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
              "إرسال"
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

// Pill input track — soft grey at rest, white on focus, rose tint on
// error. Shared by the input + select so they read as one family.
function pillInputClass(invalid: boolean): string {
  return cn(
    "w-full h-12 px-5 rounded-full text-[15px] text-black bg-black/[0.04] border outline-none transition-colors placeholder:text-black/35 text-right",
    invalid
      ? "border-rose-300 focus:bg-white focus:border-rose-400"
      : "border-transparent focus:bg-white focus:border-black/20",
  );
}

// Label-above-input shell with inline error message under the field.
// Pulled into its own component so the four fields don't re-implement
// the same label/aria/error wiring four times.
function FieldShell({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[13px] font-semibold text-black/80 mb-2 text-right"
      >
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[12px] text-rose-600 flex items-center gap-1 text-right">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
    </div>
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
