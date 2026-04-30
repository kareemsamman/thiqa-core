import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Lightbox-style image gallery for the landing page.
//
// Wrap the page in <LandingGalleryProvider>; replace any <img> that
// should be in the gallery with <GalleryImage>. Each instance
// registers its src with the provider on mount, so the gallery's
// nav order matches DOM render order. Click → opens the dialog at
// that image; arrows / keyboard ←/→ cycle through every registered
// image; ESC or click-outside closes.
//
// The context value (`register`/`unregister`/`open`) is intentionally
// stable across renders. Earlier the value object was rebuilt every
// render, which made each child's `useLayoutEffect([ctx, ...])`
// re-run, unregister, and re-register — turning every register call
// into an infinite re-render loop on mount.

interface RegisteredImage {
  src: string;
  alt: string;
}

interface GalleryContextValue {
  register: (src: string, alt: string) => void;
  unregister: (src: string) => void;
  open: (src: string) => void;
}

const GalleryContext = createContext<GalleryContextValue | null>(null);

export function LandingGalleryProvider({ children }: { children: React.ReactNode }) {
  // Map keyed by src so duplicate srcs collapse to one entry — the
  // landing has a couple of images reused across sections (e.g. the
  // demo-call mockups), and we don't want them to appear twice in
  // the nav.
  const imagesRef = useRef<Map<string, RegisteredImage>>(new Map());
  const [, setVersion] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // All callbacks read from imagesRef.current so they stay
  // referentially stable. Bumping version forces a re-render of the
  // Dialog when the Map mutates.
  const register = useCallback((src: string, alt: string) => {
    if (!imagesRef.current.has(src)) {
      imagesRef.current.set(src, { src, alt });
      setVersion((v) => v + 1);
    }
  }, []);

  const unregister = useCallback((src: string) => {
    if (imagesRef.current.delete(src)) {
      setVersion((v) => v + 1);
    }
  }, []);

  const open = useCallback((src: string) => {
    const arr = Array.from(imagesRef.current.values());
    const idx = arr.findIndex((i) => i.src === src);
    if (idx >= 0) setActiveIndex(idx);
  }, []);

  const close = useCallback(() => setActiveIndex(null), []);
  const next = useCallback(() => {
    setActiveIndex((i) => {
      const sz = imagesRef.current.size;
      if (i === null || sz === 0) return i;
      return (i + 1) % sz;
    });
  }, []);
  const prev = useCallback(() => {
    setActiveIndex((i) => {
      const sz = imagesRef.current.size;
      if (i === null || sz === 0) return i;
      return (i - 1 + sz) % sz;
    });
  }, []);

  // Keyboard nav + body-class hook so the marquee can pause itself
  // via CSS while the lightbox is up. Dialog already handles ESC and
  // outside-click on its own.
  useEffect(() => {
    if (activeIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        // RTL: left arrow goes to the next image (matches the
        // reading direction of the page).
        next();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("landing-lightbox-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("landing-lightbox-open");
    };
  }, [activeIndex, next, prev]);

  // Stable across renders → child effects don't fire spuriously.
  const ctxValue = useMemo<GalleryContextValue>(
    () => ({ register, unregister, open }),
    [register, unregister, open],
  );

  // Re-derived on every render; cheap (≤ ~25 entries) and lets the
  // Dialog see the current Map without a separate state mirror.
  const images = Array.from(imagesRef.current.values());
  const active = activeIndex !== null ? images[activeIndex] : null;
  const total = images.length;

  return (
    <GalleryContext.Provider value={ctxValue}>
      {children}
      <Dialog open={activeIndex !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent
          hideCloseButton
          className="max-w-[96vw] md:max-w-[1100px] p-0 bg-transparent border-0 shadow-none"
        >
          {active && (
            <div className="relative" dir="ltr">
              <img
                src={active.src}
                alt={active.alt}
                className="w-full h-auto max-h-[88vh] object-contain rounded-2xl shadow-[0_30px_80px_-10px_rgba(0,0,0,0.45)] bg-white/5"
                draggable={false}
              />

              {/* Close (top-left in LTR) */}
              <button
                type="button"
                onClick={close}
                aria-label="إغلاق"
                className="absolute top-3 left-3 h-10 w-10 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Counter (top-right) */}
              {total > 1 && (
                <div className="absolute top-3 right-3 px-3 h-10 rounded-full bg-black/55 text-white text-xs font-semibold flex items-center backdrop-blur-sm tabular-nums">
                  {activeIndex! + 1} / {total}
                </div>
              )}

              {/* Prev / Next arrows. Hidden when the gallery has a
                  single image. */}
              {total > 1 && (
                <>
                  <button
                    type="button"
                    onClick={prev}
                    aria-label="السابق"
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 right-3 h-12 w-12 rounded-full",
                      "bg-black/55 hover:bg-black/75 text-white flex items-center justify-center",
                      "transition-colors backdrop-blur-sm",
                    )}
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    aria-label="التالي"
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 left-3 h-12 w-12 rounded-full",
                      "bg-black/55 hover:bg-black/75 text-white flex items-center justify-center",
                      "transition-colors backdrop-blur-sm",
                    )}
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </GalleryContext.Provider>
  );
}

type GalleryImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
};

export function GalleryImage({ src, alt = "", className, onClick, ...rest }: GalleryImageProps) {
  const ctx = useContext(GalleryContext);

  useLayoutEffect(() => {
    if (!ctx || !src) return;
    ctx.register(src, alt);
    return () => ctx.unregister(src);
  }, [ctx, src, alt]);

  return (
    <img
      src={src}
      alt={alt}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) ctx?.open(src);
      }}
      className={cn(ctx && "cursor-zoom-in", className)}
      {...rest}
    />
  );
}
