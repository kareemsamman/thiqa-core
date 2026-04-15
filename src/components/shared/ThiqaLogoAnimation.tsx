import { useCallback, useEffect, useRef, useState } from "react";
import thiqaIcon from "@/assets/thiqa-logo-icon.svg";

// Circular Thiqa icon shown on the left of the animated lockup. We
// use the existing SVG asset so the logo stays crisp at any size.
const ICON_SRC = thiqaIcon;

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
}

// Animated Thiqa logo lockup for the login page. A circular icon
// pops in with a drawn outline, then slides aside while the "Thiqa"
// wordmark staggers in letter-by-letter. Click to replay.
export function ThiqaLogoAnimation({ iconSize = 92 }: ThiqaLogoAnimationProps = {}) {
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
  // the animation kicks in.
  if (t < 0) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: iconSize * 2.4,
          height: iconSize * 1.3,
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

  // Phase 3 (0.46 → 0.64): icon slides left so the wordmark has room
  const slide = easeInOutCubic(progress(t, 0.46, 0.64));

  // Phase 4 (0.54 → 0.92): wordmark letters stagger in
  const textBase = progress(t, 0.54, 0.92);

  const gap = Math.round(iconSize * 0.18);
  const fontSize = Math.round(iconSize * 0.62);
  const slideAmount = Math.round(iconSize * 0.66);
  const dashLen = 2 * Math.PI * 49;

  return (
    <div
      onClick={play}
      role="img"
      aria-label="Thiqa"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: `${lerp(0, gap, slide)}px`,
          transform: `translateX(${lerp(0, -slideAmount, slide)}px)`,
        }}
      >
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
                  src={ICON_SRC}
                  alt=""
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "block",
                    objectFit: "cover",
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
                stroke="#ffffff"
                strokeWidth="1.2"
                strokeDasharray={`${dashLen * outlineStroke} ${dashLen}`}
                strokeDashoffset={dashLen * 0.25}
                strokeLinecap="round"
                opacity={outlineOp}
              />
            </svg>
          )}
        </div>

        {/* "Thiqa" wordmark — letters stagger in from below */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize,
            fontWeight: 600,
            color: "#ffffff",
            letterSpacing: "-0.005em",
            lineHeight: 1,
            overflow: "hidden",
            whiteSpace: "nowrap",
            // Force LTR so "Thiqa" reads left-to-right even though
            // the parent login card is dir="rtl".
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
      </div>
    </div>
  );
}
