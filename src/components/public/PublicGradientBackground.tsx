// Atmospheric gradient layer used on /pricing, /faq, /contact —
// replaces the older flat purple band. Renders as a single fixed
// full-viewport div behind the page content (the page itself stays
// in normal flow, scrolling above this layer). Multiple radial
// gradients stack on top of a 95deg linear base to give a soft
// aurora effect; blur(40px) + scale(1.1) blend the layers and
// hide the radial seams. Pointer-events disabled so it never
// intercepts clicks. Fades in on mount.
export function PublicGradientBackground() {
  return (
    <div
      aria-hidden
      className="public-gradient-bg pointer-events-none fixed inset-0 z-0"
      style={{
        background: `
          radial-gradient(ellipse 60% 80% at 45% 50%, rgba(255, 200, 170, 0.95) 0%, rgba(255, 190, 160, 0.6) 25%, transparent 55%),
          radial-gradient(ellipse 70% 90% at 30% 60%, rgba(220, 215, 235, 0.9) 0%, rgba(200, 200, 230, 0.5) 35%, transparent 65%),
          radial-gradient(ellipse 80% 100% at 85% 50%, rgba(40, 50, 90, 0.95) 0%, rgba(70, 85, 130, 0.7) 30%, transparent 65%),
          radial-gradient(ellipse 60% 80% at 10% 30%, rgba(130, 140, 180, 0.6) 0%, transparent 60%),
          linear-gradient(95deg, #8a92b8 0%, #b8b5cc 25%, #d4c4c0 45%, #a8a8c8 65%, #4a5278 85%, #2a3258 100%)
        `,
        filter: "blur(40px)",
        transform: "scale(1.1)",
      }}
    />
  );
}
