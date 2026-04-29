import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { ArrowRight, Home } from "lucide-react";

if (typeof document !== "undefined") {
  const href =
    "https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap";
  if (!document.querySelector(`link[href="${href}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
}

const VIDEO_URL = "https://thiqacrm.b-cdn.net/video.mp4";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[9999] overflow-auto bg-white text-black"
      style={{ fontFamily: "'Cairo', sans-serif" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-32 h-[420px] w-[420px] rounded-full opacity-60 blur-3xl"
        style={{ background: "linear-gradient(135deg, #eef2ff 0%, #c7d2fe 100%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 -left-40 h-[360px] w-[360px] rounded-full opacity-50 blur-3xl"
        style={{ background: "linear-gradient(135deg, #f0f9ff 0%, #bae6fd 100%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 right-1/4 h-[380px] w-[380px] rounded-full opacity-40 blur-3xl"
        style={{ background: "linear-gradient(135deg, #f5f3ff 0%, #ddd6fe 100%)" }}
      />

      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 md:px-10 py-12 text-center">
        <video
          src={VIDEO_URL}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="w-full max-w-lg aspect-video rounded-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] object-cover bg-black/[0.04] opacity-0 animate-[notfound-reveal_1.1s_cubic-bezier(0.16,1,0.3,1)_120ms_forwards]"
        />

        <div
          className="mt-8 text-[5rem] md:text-[7rem] font-black leading-none tracking-tight opacity-0 animate-[notfound-reveal_1.1s_cubic-bezier(0.16,1,0.3,1)_280ms_forwards]"
          style={{
            background: "linear-gradient(135deg, #4f46e5 0%, #0284c7 50%, #7c3aed 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          404
        </div>

        <h1 className="mt-4 text-[1.4rem] md:text-[2rem] lg:text-[2.4rem] font-extrabold leading-[1.3] max-w-2xl opacity-0 animate-[notfound-reveal_1.1s_cubic-bezier(0.16,1,0.3,1)_420ms_forwards]">
          هذه الصفحة غير موجودة
        </h1>

        <p className="mt-3 text-[14px] md:text-[15px] text-black/70 max-w-md opacity-0 animate-[notfound-reveal_1.1s_cubic-bezier(0.16,1,0.3,1)_560ms_forwards]">
          الرابط الذي طلبته غير صحيح أو تمّ نقل الصفحة. يمكنك الرجوع للصفحة السابقة أو العودة إلى الصفحة الرئيسية.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center gap-3 opacity-0 animate-[notfound-reveal_1.1s_cubic-bezier(0.16,1,0.3,1)_700ms_forwards]">
          <a
            href="/landing"
            className="inline-flex items-center gap-2 rounded-full bg-black text-white text-[15px] font-bold px-9 py-3.5 transition-all hover:scale-[1.03] hover:shadow-[0_10px_28px_-6px_rgba(0,0,0,0.25)]"
          >
            <Home className="h-4 w-4" />
            <span>الصفحة الرئيسية</span>
          </a>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-full bg-white text-black border border-black/[0.12] text-[15px] font-bold px-9 py-3.5 transition-all hover:bg-black/[0.03] hover:scale-[1.02]"
          >
            <ArrowRight className="h-4 w-4" />
            <span>الرجوع للسابق</span>
          </button>
        </div>

        <div
          className="mt-10 inline-flex items-center gap-2 rounded-full bg-black/[0.04] border border-black/[0.06] px-4 py-2 text-[12px] text-black/60 font-mono opacity-0 animate-[notfound-reveal_1.1s_cubic-bezier(0.16,1,0.3,1)_840ms_forwards]"
          dir="ltr"
        >
          <span className="text-black/40">path:</span>
          <span className="font-semibold text-black/70 max-w-[280px] truncate">
            {location.pathname}
          </span>
        </div>
      </main>

      <style>{`
        @keyframes notfound-reveal {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default NotFound;
