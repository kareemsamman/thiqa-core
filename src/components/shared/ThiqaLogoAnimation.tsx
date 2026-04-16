import thiqaIconDefault from "@/assets/thiqa-logo-icon.svg";

const TEXT = "Thiqa";

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

// Static Thiqa logo lockup. Everything renders at its final geometry
// on the very first paint — no animation, no empty flash. Colors use
// `currentColor` so the parent can set a dark or light palette via
// `color:` / Tailwind text-* classes.
export function ThiqaLogoAnimation({
  iconSize = 92,
  iconSrc = thiqaIconDefault,
  iconFilter,
  subtitle,
  subtitleClassName,
}: ThiqaLogoAnimationProps = {}) {
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
        {/* Wordmark — source first, so in an RTL flex row it lands on
            the main-axis start = physical-right side of the icon. */}
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
            whiteSpace: "nowrap",
            // Force LTR so the Latin wordmark reads left-to-right
            // regardless of parent direction.
            direction: "ltr",
          }}
        >
          {TEXT}
        </div>

        {/* Icon */}
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

      {subtitle && (
        <div
          className={subtitleClassName}
          style={{
            marginTop: subtitleGap,
            lineHeight: 1.2,
            textAlign: "center",
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}
