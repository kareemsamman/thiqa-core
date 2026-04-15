import { useCallback, useEffect, useRef, useState } from "react";
import thiqaIconDefault from "@/assets/thiqa-logo-icon.svg";

const TEXT = "Thiqa";
const DURATION_MS = 2800;

// ── Easing helpers ──────────────────────────────────────────────────
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const progress = (t: number, s: number, e: number) => clamp((t - s) / (e - s));

const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Inject DM Sans once per document. Deduped by href so hot-reloads
// don't stack multiple <link> tags.
if (typeof document !== "undefined") {
  const href =
    "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,500;9..40,600;9..40,700&display=swap";
  if (!document.querySelector(`link[href="${href}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
}

interface ThiqaLogoAnimationProps {
  /** Pixel size of the circular icon. The wordmark scales off this. */
  iconSize?: number;
  /** When false, clicks do nothing and the cursor stays default. */
  interactive?: boolean;
  /** Override the icon image — e.g. pass the dark SVG on a light card. */
  iconSrc?: string;
  /** CSS filter applied to the icon <img>, e.g. `invert(1)` to darken a
   *  light-content raster for display on a light background. */
  iconFilter?: string;
  /** Optional tagline rendered below the logo lockup that staggers in
   *  word-by-word after the main animation finishes. Use this for
   *  localized product descriptions (e.g. "نظام إدارة التأمين"). */
  subtitle?: string;
  /** Tailwind class applied to the subtitle wrapper (font, color). */
  subtitleClassName?: string;
}

// Animated Thiqa logo lockup for the login page. A circular icon
// pops in with a drawn outline, then the "Thiqa" wordmark staggers
// in letter-by-letter while a gap opens up between the two. Colors
// (wordmark + outline) use `currentColor` so the parent can set a
// dark or light palette via `color:` / Tailwind text-* classes.
//
// When `subtitle` is provided, it renders under the lockup and
// staggers in by word in the last ~20% of the timeline — so the
// whole logo + tagline animates as a single cohesive sequence.
export function ThiqaLogoAnimation({
  iconSize = 92,
  interactive = true,
  iconSrc = thiqaIconDefault,
  iconFilter,
  subtitle,
  subtitleClassName,
}: ThiqaLogoAnimationProps = {}) {
  const [t, setT] = useState<number>(-1);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  const startTs = useRef<number | null>(null);

  const play = useCallback(() => {
    setT(0);
    startTs.current = null;
    setPlaying(true);
  }, []);

  // requestAnimationFrame driver — runs while `playing` is true,
  // pushing a 0→1 progress value into `t` on every frame.
  useEffect(() => {
    if (!playing) return;
    const tick = (ts: number) => {
      if (startTs.current == null) startTs.current = ts;
      const p = Math.min((ts - startTs.current) / DURATION_MS, 1);
      setT(p);
      if (p < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        setPlaying(false);
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [playing]);

  // Kick off on mount after a short pause so the parent paints its
  // final layout before the animation starts.
  useEffect(() => {
    const id = window.setTimeout(play, 400);
    return () => window.clearTimeout(id);
  }, [play]);

  // Before the first frame we render a transparent placeholder of
  // roughly the final size so the parent layout doesn't shift when
  // the animation kicks in. When a subtitle is present we add extra
  // vertical room to reserve its line height too.
  if (t < 0) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: iconSize * 2.4,
          height: iconSize * 1.3 + (subtitle ? 44 : 0),
        }}
      />
    );
  }

  // ── Timeline phases ─────────────────────────────────────────────
  // Phase 1 (0 → 0.28): icon scales up with overshoot
  const iconScale = easeOutBack(progress(t, 0, 0.28));
  const iconOpacity = easeOutExpo(progress(t, 0, 0.12));
  const iconBlur = lerp(12, 0, easeOutExpo(progress(t, 0, 0.22)));

  // Phase 2 (0.22 → 0.54): circle outline draws and then fades out
  const outlineStroke = easeOutQuint(progress(t, 0.22, 0.4));
  const outlineFade = easeOutQuint(progress(t, 0.4, 0.54));
  const outlineOp = outlineStroke * (1 - outlineFade);

  // Phase 3 (0.46 → 0.64): gap opens between icon and wordmark
  const slide = easeInOutCubic(progress(t, 0.46, 0.64));

  // Phase 4 (0.54 → 0.92): wordmark letters stagger in
  const textBase = progress(t, 0.54, 0.92);

  // Phase 5 (0.78 → 1.0): subtitle words stagger in, starting just
  // before the wordmark finishes so the two motions overlap
  // gracefully into one continuous entrance.
  const subtitleBase = progress(t, 0.78, 1.0);
  // Split on whitespace so Arabic letters stay connected (per-char
  // splits break glyph joining).
  const subtitleWords = subtitle ? subtitle.split(/\s+/).filter(Boolean) : [];

  const gap = Math.round(iconSize * 0.28);
  const fontSize = Math.round(iconSize * 0.62);
  const subtitleGap = Math.round(iconSize * 0.22);
  const dashLen = 2 * Math.PI * 49;

  const handleClick = interactive ? play : undefined;

  return (
    <div
      onClick={handleClick}
      role="img"
      aria-label={subtitle ? `Thiqa — ${subtitle}` : "Thiqa"}
      style={{
        display: "flex",
        // Column so the optional subtitle lands below the lockup.
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: interactive ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: `${lerp(0, gap, slide)}px`,
        }}
      >
        {/* Wordmark — source first, so in the login page's `dir="rtl"`
            flex row it lands on the main-axis start = physical-right
            side of the icon. In an LTR context it would land on the
            physical-left. Either way, swapping the source order
            (wordmark before icon) flips the text to the opposite side
            of where the previous revision rendered it. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize,
            fontWeight: 600,
            color: "currentColor",
            letterSpacing: "-0.005em",
            lineHeight: 1,
            overflow: "hidden",
            whiteSpace: "nowrap",
            // Force the wordmark itself to read left-to-right so the
            // letters stagger in in reading order, regardless of
            // parent direction.
            direction: "ltr",
          }}
        >
          {TEXT.split("").map((char, i) => {
            const ls = (i * 0.14) / TEXT.length;
            const le = Math.min(ls + 0.45, 1);
            const raw = progress(textBase, ls, le);
            const op = easeOutExpo(raw);
            const y = lerp(22, 0, easeOutQuint(raw));
            const sc = lerp(0.7, 1, easeOutBack(raw));

            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  opacity: op,
                  transform: `translateY(${y}px) scale(${sc})`,
                  willChange: "transform, opacity",
                }}
              >
                {char}
              </span>
            );
          })}
        </div>

        {/* Icon + animated outline ring */}
        <div
          style={{
            width: iconSize,
            height: iconSize,
            position: "relative",
            flexShrink: 0,
          }}
        >
          {iconOpacity > 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: iconSize * iconScale,
                  height: iconSize * iconScale,
                  borderRadius: "50%",
                  overflow: "hidden",
                  opacity: iconOpacity,
                  filter: `blur(${iconBlur}px)`,
                  willChange: "transform, opacity, filter",
                }}
              >
                <img
                  src={iconSrc}
                  alt=""
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "block",
                    objectFit: "cover",
                    filter: iconFilter,
                  }}
                />
              </div>
            </div>
          )}

          {outlineOp > 0.005 && (
            <svg
              viewBox="0 0 100 100"
              style={{
                position: "absolute",
                inset: -6,
                width: iconSize + 12,
                height: iconSize + 12,
                pointerEvents: "none",
              }}
            >
              <circle
                cx="50"
                cy="50"
                r="49"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeDasharray={`${dashLen * outlineStroke} ${dashLen}`}
                strokeDashoffset={dashLen * 0.25}
                strokeLinecap="round"
                opacity={outlineOp}
              />
            </svg>
          )}
        </div>
      </div>

      {/* Subtitle tagline — rendered only when provided. Word-level
          split preserves Arabic letter joining (per-char split would
          break ligatures). Each word is an inline-block so we can
          animate translateY + opacity without disrupting the text
          flow. */}
      {subtitle && (
        <div
          className={subtitleClassName}
          style={{
            marginTop: subtitleGap,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "0.3em",
            lineHeight: 1.2,
          }}
        >
          {subtitleWords.map((word, i) => {
            const n = subtitleWords.length;
            const ls = (i * 0.24) / Math.max(n, 1);
            const le = Math.min(ls + 0.55, 1);
            const raw = progress(subtitleBase, ls, le);
            const op = easeOutExpo(raw);
            const y = lerp(14, 0, easeOutQuint(raw));
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  opacity: op,
                  transform: `translateY(${y}px)`,
                  willChange: "transform, opacity",
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
