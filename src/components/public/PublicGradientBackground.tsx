// Atmospheric gradient layer used on /pricing, /faq, /contact —
// home page intentionally excluded.
//
// Structure: an outer `fixed inset-0` wrapper carries the fade mask
// and stays still. An inner div paints the actual aurora and is the
// one that animates — translateY + scale + opacity together. Because
// the mask lives on the wrapper (not the moving inner), the visible
// edges of the gradient never sweep across the viewport during the
// entrance: the wrapper's mask clips them. The result is that the
// aurora *drifts* into place from above and fades in together,
// rather than sliding as a hard rectangle.

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
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
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
