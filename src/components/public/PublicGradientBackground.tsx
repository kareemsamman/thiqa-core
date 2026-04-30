// Atmospheric gradient layer used on /pricing, /faq, /contact —
// home page intentionally excluded. The layer is fixed to the
// viewport so the aurora always rides at the top while the page
// scrolls underneath. A CSS mask fades the bottom 60% to transparent
// (cleaner than stacking a white overlay), so the page body lands
// on its own white background as the user scrolls.
//
// Five stacked radial gradients on top of a 95deg linear base for
// the aurora effect; blur(40px) + scale(1.15) blend the radials and
// hide the rectangle edge. Pointer-events disabled so it never
// intercepts clicks. The transform + drop-from-top entrance
// animation lives in index.css under .public-gradient-bg so the
// keyframe can compose with the persistent scale(1.15).

const AURORA_BACKGROUND = `
  radial-gradient(ellipse 70% 90% at 45% 30%, rgba(255, 180, 140, 1) 0%, rgba(255, 170, 130, 0.85) 25%, transparent 60%),
  radial-gradient(ellipse 80% 100% at 25% 40%, rgba(180, 175, 220, 0.95) 0%, rgba(160, 160, 210, 0.7) 35%, transparent 65%),
  radial-gradient(ellipse 90% 110% at 90% 30%, rgba(30, 40, 80, 1) 0%, rgba(60, 75, 120, 0.85) 30%, transparent 65%),
  radial-gradient(ellipse 70% 90% at 5% 20%, rgba(110, 120, 170, 0.85) 0%, transparent 60%),
  linear-gradient(95deg, #6a72a0 0%, #a8a5c4 25%, #c8b4b0 45%, #9898c0 65%, #3a4268 85%, #1a2248 100%)
`;

const FADE_MASK = "linear-gradient(to bottom, black 0%, black 40%, transparent 95%)";

export function PublicGradientBackground() {
  return (
    <div
      aria-hidden
      className="public-gradient-bg pointer-events-none fixed inset-0 z-0"
      style={{
        background: AURORA_BACKGROUND,
        filter: "blur(40px)",
        WebkitMaskImage: FADE_MASK,
        maskImage: FADE_MASK,
      }}
    />
  );
}
