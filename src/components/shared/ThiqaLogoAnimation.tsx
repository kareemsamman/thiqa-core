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

// Prefetch the icon the moment this module is parsed — earlier than
// the component mount point — so the browser already has it decoded
// by the time the login page renders. Also drop a high-priority
// preload <link> so the HTTP request is marked important.
if (typeof document !== "undefined" && typeof Image !== "undefined") {
  if (!document.querySelector(`link[data-thiqa-logo-preload]`)) {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = thiqaIconDefault;
    (link as HTMLLinkElement & { fetchPriority?: string }).fetchPriority = "high";
    link.setAttribute("data-thiqa-logo-preload", "");
    document.head.appendChild(link);
  }
  const img = new Image();
  (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = "high";
  img.decoding = "async";
  img.src = thiqaIconDefault;
}

interface ThiqaLogoAnimationProps {
  /** Pixel size of the circular icon. The wordmark scales off this. */
  iconSize?: number;
  /** Unused — kept for backwards-compat with existing callers. */
  interactive?: boolean;
  /** Override the icon image — e.g. pass the dark SVG on a light card. */
  iconSrc?: string;
  /** CSS filter applied to the icon <img>, e.g. `invert(1)` to darken a
   *  light-content raster for display on a light background. */
  iconFilter?: string;
  /** Optional tagline rendered below the logo lockup. */
  subtitle?: string;
  /** Tailwind class applied to the subtitle wrapper (font, color). */
  subtitleClassName?: string;
}

// Thiqa logo lockup for the login page. The circular icon is fully
// static — it paints at its final size/position on the first frame.
// Only the "Thiqa" wordmark animates: each letter fades + rises +
// settles, staggered L→R. Subtitle, when provided, fades+staggers in
// by word under the lockup. Colors use `currentColor`.
export function ThiqaLogoAnimation({
  iconSize = 92,
  iconSrc = thiqaIconDefault,
  iconFilter,
  subtitle,
  subtitleClassName,
}: ThiqaLogoAnimationProps = {}) {
  const [t, setT] = useState<number>(0);
  const raf = useRef<number | null>(null);
  const startTs = useRef<number | null>(null);

  const play = useCallback(() => {
    startTs.current = null;
    const tick = (ts: number) => {
      if (startTs.current == null) startTs.current = ts;
      const p = Math.min((ts - startTs.current) / DURATION_MS, 1);
      setT(p);
      if (p < 1) {
        raf.current = requestAnimationFrame(tick);
      }
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    play();
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [play]);

  // Wordmark letters stagger in over 0 → 0.55. Subtitle words stagger
  // in 0.4 → 1.0 so the two motions overlap into one cohesive settle.
  const textBase = progress(t, 0, 0.55);
  const subtitleBase = progress(t, 0.4, 1.0);

  const subtitleWords = subtitle ? subtitle.split(/\s+/).filter(Boolean) : [];

  const gap = Math.round(iconSize * 0.28);
  const fontSize = Math.round(iconSize * 0.62);
  const subtitleGap = Math.round(iconSize * 0.22);

  return (
    <div
      role="img"
      aria-label={subtitle ? `Thiqa — ${subtitle}` : "Thiqa"}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
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
        {/* Wordmark — animated letter-by-letter. Source first so in
            the login page's RTL flex row it lands on the physical
            right of the icon. */}
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
            // Force the Latin wordmark to read left-to-right so the
            // letters stagger in reading order regardless of parent.
            direction: "ltr",
          }}
        >
          {TEXT.split("").map((char, i) => {
            const ls = (i * 0.18) / TEXT.length;
            const le = Math.min(ls + 0.55, 1);
            const raw = progress(textBase, ls, le);
            const eased = easeOutQuint(raw);
            const op = easeOutExpo(raw);
            const y = lerp(22, 0, eased);
            const sc = lerp(0.85, 1, eased);

            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  opacity: op,
                  transform: `translateY(${y}px) scale(${sc})`,
                  transformOrigin: "50% 100%",
                  willChange: "transform, opacity",
                }}
              >
                {char}
              </span>
            );
          })}
        </div>

        {/* Icon — fully static. No scale/opacity/blur/outline; paints
            at final geometry on the first frame. */}
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
            loading="eager"
            decoding="async"
            // Mark the login logo as a high-priority resource so the
            // browser fetches and decodes it ahead of other assets.
            {...({ fetchpriority: "high" } as Record<string, string>)}
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
