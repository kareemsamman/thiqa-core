import { useState, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Check, X, ChevronRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Public-facing "request a demo call" modal — strain.co.il-style layout.
//
// Three tilted mockup screenshots peek above the card, Thiqa logo,
// eyebrow + big bold title, then a phone input with a chevron submit
// button (matches the demo-call section's product mockups). A short
// "what to expect" checklist sits at the bottom. The overlay is dark
// + backdrop-blur so the page behind softens.
//
// Phone is the only input. On submit the public-demo-request edge
// function creates a support ticket and emails the rep. We render
// our own Dialog primitive (instead of the project's DialogContent
// wrapper) so the overlay can carry a backdrop-blur.

interface DemoCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 10-digit local mobile starting with 05 — covers both Israeli
// (050/052/053/054/055/058) and Palestinian (056/059) prefixes.
const PHONE_RE = /^05\d{8}$/;
const THIQA_LOGO_BLACK = "https://thiqacrm.b-cdn.net/small_black.png";

// Three mockups that peek above the card. Same images as the
// demo-call section in Landing.tsx — visual continuity for the
// "احجز مكالمة تجريبية" cluster.
const PEEK_CARDS = [
  { src: "https://thiqacrm.b-cdn.net/nnnewww/demo-call-1-customers%202.png", rotate: -10, y: 10, z: 1 },
  { src: "https://thiqacrm.b-cdn.net/nnnewww/middle-mockup-control-panel%201.png", rotate: 0, y: 0, z: 3 },
  { src: "https://thiqacrm.b-cdn.net/nnnewww/demo-call-1-customers%202.png", rotate: 10, y: 10, z: 1 },
];

const BENEFITS = [
  "نتعرّف على عملك ونبني لك مساراً مخصصاً",
  "عرض عملي للمنصة مع ممثل من فريقنا",
  "نصائح لتوفير الوقت وتحسين سير العمل",
  "إجابة شاملة على كل أسئلتك",
];

const ERROR_LABELS: Record<string, string> = {
  invalid_phone: "رقم الهاتف يجب أن يبدأ بـ 05 ويتكون من 10 أرقام.",
  rate_limited: "تم استلام طلبات كثيرة من جهازك. حاول بعد قليل.",
  ticket_create_failed: "حدث خطأ مؤقت — حاول مرة أخرى.",
};

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; ticketNumber: string }
  | { kind: "error"; message: string };

export function DemoCallDialog({ open, onOpenChange }: DemoCallDialogProps) {
  const [phone, setPhone] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (!open) {
      const t = window.setTimeout(() => {
        setPhone("");
        setHoneypot("");
        setStatus({ kind: "idle" });
      }, 300);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = phone.trim();
    if (!PHONE_RE.test(trimmed)) {
      setStatus({ kind: "error", message: ERROR_LABELS.invalid_phone });
      return;
    }

    setStatus({ kind: "submitting" });
    try {
      const { data, error } = await supabase.functions.invoke("public-demo-request", {
        body: { phone: trimmed, honeypot },
      });
      if (error) throw error;
      const result = data as { ok?: boolean; ticket_number?: string; error?: string };
      if (result?.error) {
        setStatus({
          kind: "error",
          message: ERROR_LABELS[result.error] || "حدث خطأ. حاول مرة أخرى.",
        });
        return;
      }
      setStatus({ kind: "success", ticketNumber: result.ticket_number || "" });
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "تعذّر الإرسال";
      setStatus({ kind: "error", message });
    }
  };

  const submitting = status.kind === "submitting";
  const success = status.kind === "success";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/40 backdrop-blur-md",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          dir="rtl"
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "w-[95vw] max-w-md",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "focus-visible:outline-none",
          )}
        >
          <DialogPrimitive.Title className="sr-only">طلب عرض توضيحي</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            اترك رقم هاتفك ليتصل بك ممثل ثقة.
          </DialogPrimitive.Description>

          {success ? (
            <SuccessCard ticketNumber={status.ticketNumber} onClose={() => onOpenChange(false)} />
          ) : (
            <div className="relative">
              {/* Peek mockups above the card. They sit just above the
                  card with a small gap so the close button stays
                  visible (no overlap into the card's top edge). */}
              <div className="relative h-28 md:h-32 flex items-end justify-center gap-2 mb-3 pointer-events-none">
                {PEEK_CARDS.map((card, i) => (
                  <div
                    key={i}
                    className="relative w-[110px] h-[78px] md:w-[140px] md:h-[96px] rounded-xl overflow-hidden bg-white border border-black/[0.06] shadow-[0_12px_30px_-10px_rgba(0,0,0,0.25)]"
                    style={{
                      transform: `rotate(${card.rotate}deg) translateY(${card.y}px)`,
                      zIndex: card.z,
                    }}
                  >
                    <img src={card.src} alt="" aria-hidden="true" className="w-full h-full object-cover" draggable={false} />
                  </div>
                ))}
              </div>

              {/* Main card */}
              <div className="relative bg-white rounded-[28px] shadow-2xl shadow-black/30 px-6 pt-12 pb-7 md:px-8 md:pt-14 md:pb-8">
                <DialogPrimitive.Close
                  className="absolute top-4 left-4 h-8 w-8 rounded-full flex items-center justify-center text-black/55 hover:text-black hover:bg-black/[0.05] transition-colors"
                  aria-label="إغلاق"
                >
                  <X className="h-5 w-5" strokeWidth={2.5} />
                </DialogPrimitive.Close>

                <img
                  src={THIQA_LOGO_BLACK}
                  alt="Thiqa"
                  className="h-12 mx-auto mb-6 select-none"
                  draggable={false}
                />

                <p className="text-[12px] text-center text-black/55 mb-2 tracking-wide">
                  طلب عرض توضيحي مع ممثل
                </p>
                <h2 className="text-[26px] md:text-3xl font-extrabold text-center text-black leading-tight mb-6">
                  تعرّفوا على ثقة عن قرب
                </h2>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  {/* Honeypot — bots tend to fill every field. */}
                  <input
                    type="text"
                    name="company"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
                  />

                  {/* Phone row: chevron submit on the LEFT (visual end
                      in RTL — feels like "send" / "next"); input fills
                      the rest. Phone is digits-only, exactly 10 chars
                      starting with 05. We surface the validation
                      reason below the input as soon as the user has
                      typed something that doesn't match — silent
                      while empty so the field doesn't shout at first
                      paint. */}
                  {(() => {
                    const isInvalid = phone.length > 0 && !PHONE_RE.test(phone);
                    return (
                      <>
                        <div className="flex items-stretch gap-2">
                          <button
                            type="submit"
                            disabled={submitting || !PHONE_RE.test(phone)}
                            aria-label="إرسال"
                            className={cn(
                              "shrink-0 h-12 w-12 rounded-full flex items-center justify-center transition-all",
                              submitting || !PHONE_RE.test(phone)
                                ? "bg-black/[0.05] text-black/30 cursor-not-allowed"
                                : "bg-black text-white hover:bg-black/85 shadow-md",
                            )}
                          >
                            {submitting ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
                            )}
                          </button>
                          <Input
                            type="tel"
                            inputMode="numeric"
                            pattern="05\d{8}"
                            maxLength={10}
                            dir="ltr"
                            placeholder="05XXXXXXXX"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                            required
                            aria-invalid={isInvalid}
                            aria-describedby={isInvalid ? "demo-phone-error" : undefined}
                            className={cn(
                              "flex-1 h-12 rounded-full text-left px-5 text-base placeholder:text-black/35 focus-visible:ring-2",
                              isInvalid
                                ? "bg-rose-500/[0.06] border border-rose-500/40 focus-visible:ring-rose-500/25"
                                : "bg-black/[0.04] border-0 focus-visible:ring-black/15",
                            )}
                          />
                        </div>

                        {isInvalid && (
                          <p id="demo-phone-error" className="mt-2 text-[13px] text-rose-600 text-right" dir="rtl">
                            {ERROR_LABELS.invalid_phone}
                          </p>
                        )}
                      </>
                    );
                  })()}

                  {status.kind === "error" && (
                    <div className="flex items-start gap-2 mt-3 p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-sm">
                      <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                      <span className="text-rose-700 dark:text-rose-300">{status.message}</span>
                    </div>
                  )}
                </form>

                <h3 className="text-[14px] font-bold text-black text-right mt-8 mb-3">
                  ما الذي تتوقع من المكالمة؟
                </h3>
                <ul className="space-y-2.5 text-right">
                  {BENEFITS.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-[13px] text-black/70 leading-relaxed">
                      <Check className="h-4 w-4 text-black shrink-0 mt-0.5" strokeWidth={2.5} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SuccessCard({ ticketNumber, onClose }: { ticketNumber: string; onClose: () => void }) {
  return (
    <div className="relative bg-white rounded-[28px] shadow-2xl shadow-black/30 px-6 py-12 md:px-10 md:py-14 text-center">
      <DialogPrimitive.Close
        className="absolute top-4 left-4 h-8 w-8 rounded-full flex items-center justify-center text-black/55 hover:text-black hover:bg-black/[0.05] transition-colors"
        aria-label="إغلاق"
      >
        <X className="h-5 w-5" strokeWidth={2.5} />
      </DialogPrimitive.Close>

      <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
        <CheckCircle2 className="h-7 w-7 text-emerald-600" />
      </div>
      <h3 className="text-2xl font-extrabold text-black mb-2">شكراً لك!</h3>
      <p className="text-[15px] text-black/65 leading-relaxed mb-6 max-w-sm mx-auto">
        استلمنا طلبك وسيتصل بك ممثلنا قريباً — عادة خلال ساعات العمل.
      </p>
      {ticketNumber && (
        <div className="inline-block rounded-lg bg-black/[0.04] px-4 py-2 text-sm">
          <span className="text-black/55">رقم الطلب: </span>
          <span className="font-bold text-black ltr-nums" dir="ltr">{ticketNumber}</span>
        </div>
      )}
      <div className="mt-8">
        <Button onClick={onClose} variant="outline" className="rounded-full px-6">
          إغلاق
        </Button>
      </div>
    </div>
  );
}

// Convenience wrapper that owns its own dialog state. Drop in place
// of an old `<a href="mailto:…">` and pass the original anchor's
// children. The `className` you provide styles the trigger (the link
// or button row in the support menu / footer); the dialog itself is
// styled internally and ignores trigger styling.
export function DemoCallTrigger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        {children}
      </button>
      <DemoCallDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
