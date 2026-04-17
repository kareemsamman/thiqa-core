import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

// Persisted choice — once a visitor accepts or declines, the banner
// stays hidden on every public page. Stored under a Thiqa-namespaced
// key so it doesn't collide with other apps in the same origin.
const STORAGE_KEY = "thiqa-cookie-consent";
type Choice = "accepted" | "declined";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY) as Choice | null;
      // Show only when no choice has been recorded yet.
      if (v !== "accepted" && v !== "declined") setVisible(true);
    } catch {
      // localStorage blocked → just show the banner; the user can dismiss
      // it for the session and it'll come back next visit.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const decide = (choice: Choice) => {
    try { localStorage.setItem(STORAGE_KEY, choice); } catch {}
    setVisible(false);
  };

  return (
    <div
      className="fixed bottom-4 inset-x-4 z-[55] flex justify-center pointer-events-none"
      dir="rtl"
      role="dialog"
      aria-label="إعدادات ملفات تعريف الارتباط"
    >
      <div className="pointer-events-auto max-w-2xl w-full bg-white border border-black/10 rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.18)] p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4">
        <p className="flex-1 text-[13px] md:text-[14px] text-black/75 leading-relaxed text-right">
          نستخدم ملفات تعريف الارتباط (cookies) لتحسين تجربتك وتذكّر تفضيلاتك.{" "}
          <Link to="/privacy" className="font-semibold text-black underline underline-offset-2 hover:opacity-80">
            سياسة الخصوصية
          </Link>
          .
        </p>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={() => decide("declined")}
            className="flex-1 md:flex-none h-10 px-5 rounded-full text-[13px] font-semibold border border-black/15 text-black hover:bg-black/5 transition-colors"
          >
            رفض
          </button>
          <button
            type="button"
            onClick={() => decide("accepted")}
            className="flex-1 md:flex-none h-10 px-5 rounded-full text-[13px] font-bold bg-black text-white hover:bg-black/85 transition-colors"
          >
            قبول
          </button>
        </div>
      </div>
    </div>
  );
}
