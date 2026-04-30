import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Phone, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Public-facing "request a demo call" modal.
//
// Triggered from the support menus and footers on Landing / Pricing /
// FAQ. Captures a phone number (required) plus an optional name and
// note, posts to the public-demo-request edge function, and shows a
// success state with the ticket number on completion.

interface DemoCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PHONE_RE = /^[+\d][\d\s().-]{5,24}$/;

const ERROR_LABELS: Record<string, string> = {
  invalid_phone: "رقم الهاتف غير صالح. اكتب الرقم بدون أحرف.",
  invalid_name: "الاسم طويل جداً.",
  invalid_email: "البريد الإلكتروني غير صالح.",
  invalid_note: "الملاحظة طويلة جداً.",
  rate_limited: "تم استلام طلبات كثيرة من جهازك. حاول بعد قليل.",
  ticket_create_failed: "حدث خطأ مؤقت — حاول مرة أخرى.",
};

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; ticketNumber: string }
  | { kind: "error"; message: string };

export function DemoCallDialog({ open, onOpenChange }: DemoCallDialogProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Reset form whenever the dialog re-opens so a previous success
  // state doesn't bleed into a fresh request.
  useEffect(() => {
    if (open) {
      setStatus({ kind: "idle" });
    } else {
      // Wait for close animation before clearing the fields, so the
      // user doesn't see them blank out as the dialog fades.
      const t = window.setTimeout(() => {
        setName("");
        setPhone("");
        setEmail("");
        setNote("");
        setHoneypot("");
        setStatus({ kind: "idle" });
      }, 300);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const submit = async () => {
    const trimmedPhone = phone.trim();
    if (!PHONE_RE.test(trimmedPhone)) {
      setStatus({ kind: "error", message: ERROR_LABELS.invalid_phone });
      return;
    }

    setStatus({ kind: "submitting" });
    try {
      const { data, error } = await supabase.functions.invoke("public-demo-request", {
        body: {
          name: name.trim() || undefined,
          phone: trimmedPhone,
          email: email.trim() || undefined,
          note: note.trim() || undefined,
          honeypot,
        },
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-w-lg p-0 overflow-hidden"
      >
        {success ? (
          <div className="px-6 py-10 md:px-10 md:py-12 text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
            <h3 className="text-2xl font-extrabold text-black mb-2">شكراً لك!</h3>
            <p className="text-[15px] text-black/65 leading-relaxed mb-6 max-w-sm mx-auto">
              استلمنا طلبك وسيتصل بك ممثلنا قريباً — عادة خلال ساعات العمل.
            </p>
            {status.ticketNumber && (
              <div className="inline-block rounded-lg bg-black/[0.04] px-4 py-2 text-sm">
                <span className="text-black/55">رقم الطلب: </span>
                <span className="font-bold text-black ltr-nums" dir="ltr">{status.ticketNumber}</span>
              </div>
            )}
            <div className="mt-8">
              <Button onClick={() => onOpenChange(false)} variant="outline" className="rounded-full px-6">
                إغلاق
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-8 md:px-10 md:py-10">
            <div className="text-center mb-6">
              <div className="mx-auto h-14 w-14 rounded-full bg-black/[0.04] flex items-center justify-center mb-4">
                <Phone className="h-6 w-6 text-black" />
              </div>
              <p className="text-xs uppercase tracking-[0.18em] text-black/55 mb-2">طلب عرض توضيحي</p>
              <h2 className="text-2xl md:text-3xl font-extrabold text-black leading-tight">
                تعرّفوا على ثقة عن قرب
              </h2>
              <p className="text-sm text-black/60 mt-2 leading-relaxed">
                اتركوا رقم الهاتف وسيتصل بكم ممثلنا في أقرب وقت — بدون التزام وبدون أي تكلفة.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="space-y-3"
            >
              {/* Honeypot — hidden from users; bots tend to fill every input. */}
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

              <div>
                <Label htmlFor="demo-phone" className="text-sm font-semibold mb-1.5 block">
                  رقم الهاتف <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="demo-phone"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  placeholder="05X-XXX-XXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="text-left h-11"
                />
              </div>

              <div>
                <Label htmlFor="demo-name" className="text-sm font-semibold mb-1.5 block">
                  الاسم <span className="text-black/40 font-normal">(اختياري)</span>
                </Label>
                <Input
                  id="demo-name"
                  type="text"
                  placeholder="اسمك الكامل"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11"
                />
              </div>

              <div>
                <Label htmlFor="demo-note" className="text-sm font-semibold mb-1.5 block">
                  ما الذي تودّ معرفته؟ <span className="text-black/40 font-normal">(اختياري)</span>
                </Label>
                <Textarea
                  id="demo-note"
                  rows={3}
                  placeholder="مثلاً: أبحث عن نظام لوكالة بثلاث فروع…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="resize-none"
                />
              </div>

              {status.kind === "error" && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-sm">
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="text-rose-700 dark:text-rose-300">{status.message}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={submitting || !phone.trim()}
                className="w-full h-12 rounded-full bg-black hover:bg-black/85 text-white text-[15px] font-bold mt-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin ml-2" />
                    جاري الإرسال…
                  </>
                ) : (
                  "اطلب الاتصال"
                )}
              </Button>

              <p className="text-[11px] text-black/45 text-center mt-2">
                بإرسالك الطلب فأنت توافق على تواصل فريقنا معك عبر الهاتف.
              </p>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Convenience wrapper that handles its own dialog state. Drop this in
// place of an old `<a href="mailto:…">` and pass the original anchor's
// child markup. The `as` prop lets the caller render either an `<a>`-
// styled trigger (footer link) or a `<button>` row (support menu).
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
