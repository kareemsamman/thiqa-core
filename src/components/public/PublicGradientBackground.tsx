// Atmospheric gradient band used on /pricing, /faq, /contact —
// home page intentionally excluded.
//
// Anchored to the top of the page (absolute, not fixed), 720px
// tall — same shape as the old purple band so it scrolls AWAY with
// the page rather than tracking the viewport.
//
// Two layers: an outer wrapper carries the fade mask + clips
// overflow, an inner div paints the aurora and is the one that
// animates. With the mask on the stationary wrapper, the inner can
// translate freely without ever showing a hard edge — the aurora
// drifts into place from above and fades in together, rather than
// sliding as a rectangle.

const AURORA_BACKGROUND = `
  radial-gradient(ellipse 70% 90% at 45% 30%, rgba(255, 180, 140, 1) 0%, rgba(255, 170, 130, 0.85) 25%, transparent 60%),
  radial-gradient(ellipse 80% 100% at 25% 40%, rgba(180, 175, 220, 0.95) 0%, rgba(160, 160, 210, 0.7) 35%, transparent 65%),
  radial-gradient(ellipse 90% 110% at 90% 30%, rgba(30, 40, 80, 1) 0%, rgba(60, 75, 120, 0.85) 30%, transparent 65%),
  radial-gradient(ellipse 70% 90% at 5% 20%, rgba(110, 120, 170, 0.85) 0%, transparent 60%),
  linear-gradient(95deg, #6a72a0 0%, #a8a5c4 25%, #c8b4b0 45%, #9898c0 65%, #3a4268 85%, #1a2248 100%)
`;

const FADE_MASK = "linear-gradient(to bottom, black 0%, black 20%, transparent 55%)";

export function PublicGradientBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 inset-x-0 h-[720px] z-0 overflow-hidden"
      style={{
        WebkitMaskImage: FADE_MASK,
        maskImage: FADE_MASK,
      }}
    >
      <div
        className="public-gradient-bg absolute inset-0"
        style={{
          background: AURORA_BACKGROUND,
          filter: "blur(40px)",
        }}
      />
    </div>
  );
}
