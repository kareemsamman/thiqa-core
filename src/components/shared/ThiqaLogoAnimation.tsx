import { useCallback, useEffect, useRef, useState } from "react";
import thiqaIconDefault from "@/assets/thiqa-logo-icon.svg";

const TEXT = "Thiqa";
const DURATION_MS = 2800;

// ── Easing helpers ──────────────────────────────────────────────────
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const progress = (t: number, s: number, e: number) => clamp((t - s) / (e - s));

const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
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

// Animated Thiqa logo lockup for the login page. The icon + wordmark
// are painted at their final position on the very first frame (no
// empty placeholder, no blank flash). A light settle animation then
// runs over the first ~2.8s: the "Thiqa" letters slide up into place
// and, when provided, the subtitle words stagger in below. Colors use
// `currentColor` so the parent can set a dark or light palette via
// `color:` / Tailwind text-* classes.
export function ThiqaLogoAnimation({
  iconSize = 92,
  interactive = true,
  iconSrc = thiqaIconDefault,
  iconFilter,
  subtitle,
  subtitleClassName,
}: ThiqaLogoAnimationProps = {}) {
  // `t` starts at 0 so the very first paint already renders the logo
  // in a visible state — no transparent placeholder, no 400ms gap
  // before anything shows up. The entry animation is now a short,
  // additive settle (letters translating + subtitle fading in) that
  // layers on top of an already-present lockup.
  const [t, setT] = useState<number>(0);
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

  // Kick off immediately on mount — no artificial delay, so the
  // logo never flashes a blank/empty frame on the login screen.
  useEffect(() => {
    play();
  }, [play]);

  // ── Timeline phases ─────────────────────────────────────────────
  // Icon, gap and wordmark position are fixed at the final state
  // from the very first paint — no empty slot on load. Only two
  // subtle motions remain:
  //   • wordmark letters slide up into place (0 → 0.7)
  //   • subtitle words stagger in underneath    (0.4 → 1.0)
  const textBase = progress(t, 0, 0.7);
  const subtitleBase = progress(t, 0.4, 1.0);

  // Split on whitespace so Arabic letters stay connected (per-char
  // splits break glyph joining).
  const subtitleWords = subtitle ? subtitle.split(/\s+/).filter(Boolean) : [];

  const gap = Math.round(iconSize * 0.28);
  const fontSize = Math.round(iconSize * 0.62);
  const subtitleGap = Math.round(iconSize * 0.22);

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
          gap: `${gap}px`,
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
            // Letters are always visible on first paint; they just
            // settle into place with a small vertical slide. No more
            // "icon visible next to an empty slot" on mount.
            const ls = (i * 0.14) / TEXT.length;
            const le = Math.min(ls + 0.45, 1);
            const raw = progress(textBase, ls, le);
            const y = lerp(8, 0, easeOutQuint(raw));

            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  transform: `translateY(${y}px)`,
                  willChange: "transform",
                }}
              >
                {char}
              </span>
            );
          })}
        </div>

        {/* Icon — rendered statically at its final size/opacity so the
            login screen never shows an empty placeholder on mount. */}
        <div
          style={{
            width: iconSize,
            height: iconSize,
            borderRadius: "50%",
            overflow: "hidden",
            flexShrink: 0,
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
