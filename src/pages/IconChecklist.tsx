import { useEffect, useMemo, useState } from "react";
import { CheckCircle, ExternalLink, Loader2, XCircle } from "lucide-react";
import { PublicSEO } from "@/components/public/PublicSEO";
import { cn } from "@/lib/utils";

type CheckState = "checking" | "pass" | "fail";

type IconCheck = {
  label: string;
  detail: string;
  state: CheckState;
};

const imageSize = (src: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });

export default function IconChecklist() {
  const [checks, setChecks] = useState<IconCheck[]>([
    { label: "apple-touch-icon", detail: "جارٍ الفحص", state: "checking" },
    { label: "manifest 192x192", detail: "جارٍ الفحص", state: "checking" },
    { label: "manifest 512x512", detail: "جارٍ الفحص", state: "checking" },
    { label: "favicon.ico", detail: "جارٍ الفحص", state: "checking" },
  ]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const next: IconCheck[] = [];
      const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
      try {
        const size = apple?.href ? await imageSize(apple.href) : null;
        const ok = Boolean(apple?.href && apple.sizes?.value === "180x180" && size?.width === 180 && size?.height === 180);
        next.push({
          label: "apple-touch-icon",
          detail: ok ? `${apple?.getAttribute("href")} — ${size?.width}×${size?.height}` : "يجب أن يكون PNG بحجم 180×180",
          state: ok ? "pass" : "fail",
        });
      } catch {
        next.push({ label: "apple-touch-icon", detail: "تعذر تحميل الأيقونة", state: "fail" });
      }

      try {
        const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
        const manifest = await fetch(manifestLink?.href || "/site.webmanifest", { cache: "no-store" }).then((r) => r.json());
        const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
        for (const wanted of ["192x192", "512x512"]) {
          const icon = icons.find((i: { sizes?: string; type?: string; src?: string }) => i.sizes === wanted && i.type === "image/png");
          const src = icon?.src ? new URL(icon.src, window.location.origin).toString() : "";
          const size = src ? await imageSize(src) : null;
          const px = Number(wanted.split("x")[0]);
          const ok = Boolean(icon && size?.width === px && size?.height === px);
          next.push({
            label: `manifest ${wanted}`,
            detail: ok ? `${icon.src} — ${size?.width}×${size?.height}` : `يجب أن يحتوي manifest على PNG ${wanted}`,
            state: ok ? "pass" : "fail",
          });
        }
      } catch {
        next.push({ label: "manifest 192x192", detail: "تعذر قراءة manifest", state: "fail" });
        next.push({ label: "manifest 512x512", detail: "تعذر قراءة manifest", state: "fail" });
      }

      try {
        const response = await fetch("/favicon.ico", { cache: "no-store" });
        next.push({
          label: "favicon.ico",
          detail: response.ok ? "/favicon.ico موجود للمتصفحات التي تطلبه تلقائياً" : "favicon.ico غير متاح",
          state: response.ok ? "pass" : "fail",
        });
      } catch {
        next.push({ label: "favicon.ico", detail: "تعذر فحص favicon.ico", state: "fail" });
      }

      if (!cancelled) setChecks(next);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const allPassed = useMemo(() => checks.every((check) => check.state === "pass"), [checks]);

  return (
    <main className="min-h-screen bg-background text-foreground" dir="rtl">
      <PublicSEO
        title="Thiqa | فحص أيقونات iOS"
        description="صفحة فحص سريعة لأيقونات iOS Safari وbookmark وweb manifest."
        pathname="/icon-checklist"
      />
      <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-12">
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold text-primary">iOS Safari</p>
          <h1 className="text-3xl font-bold leading-tight md:text-4xl">فحص أيقونات التبويب والحفظ</h1>
          <p className="mt-4 text-muted-foreground">تتحقق هذه الصفحة من apple-touch-icon وحجوم web manifest المستخدمة على الجوال.</p>
        </div>

        <div className="space-y-3">
          {checks.map((check) => (
            <div key={check.label} className="flex items-start gap-3 rounded-lg border bg-card p-4 text-card-foreground">
              {check.state === "checking" ? (
                <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-muted-foreground" />
              ) : check.state === "pass" ? (
                <CheckCircle className="mt-0.5 h-5 w-5 text-primary" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{check.label}</h2>
                <p className="mt-1 break-words text-sm text-muted-foreground">{check.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className={cn("mt-6 rounded-lg border p-4 text-sm", allPassed ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          {allPassed ? "كل الفحوصات نجحت. على iPhone قد تحتاج لمسح كاش Safari أو إعادة إضافة bookmark لأن iOS يخزن الأيقونة بقوة." : "إذا ظهر فشل، افتح الصفحة بعد النشر وتأكد أن الملفات تُحمّل من نفس الدومين."}
        </div>

        <a href="/" className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-primary">
          العودة للصفحة الرئيسية
          <ExternalLink className="h-4 w-4" />
        </a>
      </section>
    </main>
  );
}