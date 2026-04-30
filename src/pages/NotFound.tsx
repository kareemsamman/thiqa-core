import { useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import { Headphones, Home } from "lucide-react";
import { NoIndex } from "@/components/seo/NoIndex";

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
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    // playbackRate isn't a JSX prop on <video>, has to be set on the
    // node itself. Re-apply on every load so it survives reflows.
    const v = videoRef.current;
    if (!v) return;
    const apply = () => {
      v.playbackRate = 2;
    };
    apply();
    v.addEventListener("loadedmetadata", apply);
    v.addEventListener("play", apply);
    return () => {
      v.removeEventListener("loadedmetadata", apply);
      v.removeEventListener("play", apply);
    };
  }, []);

  return (
    <>
    <NoIndex />
    <div
      dir="rtl"
      className="fixed inset-0 z-[9999] h-screen w-screen overflow-hidden bg-black text-white"
      style={{ fontFamily: "'Cairo', sans-serif" }}
    >
      <video
        ref={videoRef}
        src={VIDEO_URL}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-cover"
      />

      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/70"
      />

      <main className="relative z-10 h-full flex flex-col items-center justify-center px-6 md:px-10 text-center">
        <div
          className="text-[5rem] md:text-[8rem] font-black leading-none tracking-tight drop-shadow-[0_4px_20px_rgba(0,0,0,0.5)] opacity-0 animate-[notfound-reveal_1.1s_cubic-bezier(0.16,1,0.3,1)_120ms_forwards]"
          style={{
            background: "linear-gradient(135deg, #ffffff 0%, #c7d2fe 50%, #ddd6fe 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          404
        </div>

        <h1 className="mt-3 text-[1.4rem] md:text-[2rem] lg:text-[2.4rem] font-extrabold leading-[1.3] max-w-2xl text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)] opacity-0 animate-[notfound-reveal_1.1s_cubic-bezier(0.16,1,0.3,1)_280ms_forwards]">
          هذه الصفحة غير موجودة
        </h1>

        <p className="mt-3 text-[14px] md:text-[15px] text-white/80 max-w-md drop-shadow-[0_1px_8px_rgba(0,0,0,0.4)] opacity-0 animate-[notfound-reveal_1.1s_cubic-bezier(0.16,1,0.3,1)_420ms_forwards]">
          الرابط الذي طلبته غير صحيح أو تمّ نقل الصفحة. يمكنك العودة إلى الصفحة الرئيسية أو التواصل مع فريق الدعم.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center gap-3 opacity-0 animate-[notfound-reveal_1.1s_cubic-bezier(0.16,1,0.3,1)_560ms_forwards]">
          <a
            href="/landing"
            className="inline-flex items-center gap-2 rounded-full bg-white text-black text-[15px] font-bold px-9 py-3.5 transition-all hover:scale-[1.03] hover:shadow-[0_10px_28px_-6px_rgba(0,0,0,0.4)]"
          >
            <Home className="h-4 w-4" />
            <span>الصفحة الرئيسية</span>
          </a>
          <a
            href="/landing/support"
            className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur text-white border border-white/30 text-[15px] font-bold px-9 py-3.5 transition-all hover:bg-white/20 hover:scale-[1.02]"
          >
            <Headphones className="h-4 w-4" />
            <span>الدعم</span>
          </a>
        </div>

        <div
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur border border-white/20 px-4 py-2 text-[12px] text-white/80 font-mono opacity-0 animate-[notfound-reveal_1.1s_cubic-bezier(0.16,1,0.3,1)_700ms_forwards]"
          dir="ltr"
        >
          <span className="text-white/50">path:</span>
          <span className="font-semibold max-w-[280px] truncate">{location.pathname}</span>
        </div>
      </main>

      <style>{`
        @keyframes notfound-reveal {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
    </>
  );
};

export default NotFound;
