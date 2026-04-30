// Custom smooth-scroll used by the landing page nav anchors.
//
// Browser-native scrollIntoView({ behavior: 'smooth' }) is decent but
// non-configurable: the duration and easing are browser-defined and
// it ignores the fixed navbar so the destination heading lands hidden
// under the pill. This helper does both — eases over a configurable
// duration with cubic-easeInOut and offsets the target by the navbar
// height before scrolling.
//
// Honors prefers-reduced-motion: in that mode it just jumps to the
// destination instantly, no animation.

export const PUBLIC_HEADER_OFFSET = 96;

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function smoothScrollToElement(
  el: HTMLElement,
  options: { offset?: number; duration?: number } = {},
): void {
  const offset = options.offset ?? PUBLIC_HEADER_OFFSET;
  const duration = options.duration ?? 850;

  const targetTop = el.getBoundingClientRect().top + window.pageYOffset - offset;
  const startTop = window.pageYOffset;
  const distance = targetTop - startTop;

  if (Math.abs(distance) < 1) return;

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    window.scrollTo(0, targetTop);
    return;
  }

  let startTime: number | null = null;
  const step = (now: number) => {
    if (startTime === null) startTime = now;
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    window.scrollTo(0, startTop + distance * easeInOutCubic(t));
    if (t < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

// Resolve a hash ("#demo") to its target element, then scroll. Used
// from anchor click handlers and from the Landing mount-effect when
// the URL arrives with a hash from another page.
export function smoothScrollToHash(hash: string): boolean {
  if (!hash || hash === "#") return false;
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  const el = document.getElementById(id);
  if (!el) return false;
  smoothScrollToElement(el);
  return true;
}
