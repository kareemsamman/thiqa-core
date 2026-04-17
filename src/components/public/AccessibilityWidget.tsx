import { useEffect, useState } from "react";
import { Accessibility, X, RotateCcw, Contrast, CircleDashed, Link2, MousePointer2 } from "lucide-react";

// Floating accessibility widget — black FAB at the bottom-left with a
// white wheelchair icon. Clicking it reveals a panel with font-size
// controls and four toggles. State persists in localStorage and is
// applied via data-* attributes on <html> so the CSS in index.css
// can hook into it without prop-drilling.
type FontSize = "normal" | "large" | "xlarge";
type A11ySettings = {
  fontSize: FontSize;
  highContrast: boolean;
  grayscale: boolean;
  highlightLinks: boolean;
  bigCursor: boolean;
};

const STORAGE_KEY = "thiqa-a11y";
const DEFAULT_SETTINGS: A11ySettings = {
  fontSize: "normal",
  highContrast: false,
  grayscale: false,
  highlightLinks: false,
  bigCursor: false,
};

function loadSettings(): A11ySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<A11ySettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function applySettings(s: A11ySettings) {
  const html = document.documentElement;
  html.dataset.a11yFontSize = s.fontSize;
  html.dataset.a11yHighContrast = String(s.highContrast);
  html.dataset.a11yGrayscale = String(s.grayscale);
  html.dataset.a11yHighlightLinks = String(s.highlightLinks);
  html.dataset.a11yBigCursor = String(s.bigCursor);
}

export function AccessibilityWidget() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<A11ySettings>(loadSettings);

  useEffect(() => {
    applySettings(settings);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);

  // Restore previously chosen settings on first load even before the
  // user opens the panel.
  useEffect(() => { applySettings(loadSettings()); }, []);

  const toggle = (k: keyof A11ySettings) => () =>
    setSettings((p) => ({ ...p, [k]: !p[k] } as A11ySettings));
  const setFontSize = (size: FontSize) =>
    setSettings((p) => ({ ...p, fontSize: size }));
  const reset = () => setSettings(DEFAULT_SETTINGS);

  return (
    <>
      {/* Floating action button — bottom-LEFT to avoid colliding with
          the bottom-right chat widgets used elsewhere in the app. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="إعدادات إمكانية الوصول"
        className="fixed bottom-4 left-4 z-[60] h-12 w-12 rounded-full bg-black text-white shadow-[0_8px_24px_-6px_rgba(0,0,0,0.45)] flex items-center justify-center hover:bg-black/85 transition-colors"
      >
        <Accessibility className="h-6 w-6" strokeWidth={2} />
      </button>

      {/* Panel — opens directly above the FAB. White background per the
          design spec (the reference design uses a black panel; we flip
          it to white so it reads on Thiqa's clean public pages). */}
      {open && (
        <>
          {/* Click-outside scrim — invisible, lets the user dismiss the
              panel by tapping anywhere off it. */}
          <div
            className="fixed inset-0 z-[59]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="fixed bottom-4 left-4 z-[60] w-[320px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white border border-black/10 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.25)] p-5"
            dir="rtl"
            role="dialog"
            aria-label="إعدادات إمكانية الوصول"
          >
            <div className="flex items-center justify-between mb-5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="إغلاق"
                className="text-black/55 hover:text-black transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-bold text-black">إمكانية الوصول</h3>
                <Accessibility className="h-5 w-5 text-black" />
              </div>
            </div>

            {/* Font size selector — three pills, current is filled black */}
            <div className="mb-4">
              <p className="text-right text-[12px] text-black/55 mb-2">حجم الخط</p>
              <div className="grid grid-cols-3 gap-2">
                {(["normal", "large", "xlarge"] as FontSize[]).map((size) => {
                  const active = settings.fontSize === size;
                  const label = size === "normal" ? "A" : size === "large" ? "+A" : "++A";
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setFontSize(size)}
                      aria-pressed={active}
                      className={`h-12 rounded-xl border-2 transition-colors flex items-center justify-center font-bold text-base ${
                        active
                          ? "bg-black text-white border-black"
                          : "bg-white text-black border-black/15 hover:bg-black/[0.04]"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-2">
              <Toggle icon={<Contrast className="h-4 w-4" />} label="ألوان عالية التباين" checked={settings.highContrast} onChange={toggle("highContrast")} />
              <Toggle icon={<CircleDashed className="h-4 w-4" />} label="تدرّج رمادي" checked={settings.grayscale} onChange={toggle("grayscale")} />
              <Toggle icon={<Link2 className="h-4 w-4" />} label="إبراز الروابط" checked={settings.highlightLinks} onChange={toggle("highlightLinks")} />
              <Toggle icon={<MousePointer2 className="h-4 w-4" />} label="مؤشر كبير" checked={settings.bigCursor} onChange={toggle("bigCursor")} />
            </div>

            <button
              type="button"
              onClick={reset}
              className="w-full mt-4 h-11 rounded-xl border border-black/15 text-[13px] text-black hover:bg-black/[0.04] transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              إعادة تعيين الإعدادات
            </button>
          </div>
        </>
      )}
    </>
  );
}

// Single toggle row — label on the right, icon next to it, then the
// switch on the left (in RTL natural reading order). The whole row is
// the click target, not just the switch.
function Toggle({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-black/10 hover:bg-black/[0.03] transition-colors"
    >
      {/* Switch (visual right side under RTL = end) */}
      <span
        className={`relative inline-block h-5 w-9 rounded-full transition-colors flex-shrink-0 ${
          checked ? "bg-black" : "bg-black/20"
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
            checked ? "right-[1.125rem]" : "right-0.5"
          }`}
        />
      </span>
      {/* Label + icon (visual right under RTL flex) */}
      <span className="flex items-center gap-2 text-[13px] text-black">
        <span>{label}</span>
        <span className="text-black/55">{icon}</span>
      </span>
    </button>
  );
}
