import { cn } from "@/lib/utils";

const THIQA_LOGO_URL = "https://thiqacrm.b-cdn.net/Group%201000011517.png";

interface LoadingScreenProps {
  /** Override the default 'جاري التحميل...' caption. */
  message?: string;
  /** Drop the full-screen min-height when embedded inside a smaller surface. */
  inline?: boolean;
  className?: string;
}

// Full-screen loading state shown during auth resolution and other
// initial-fetch gates. The Thiqa logo sits inside a soft glow ring with
// a continuous breathing animation; an outer dashed ring slowly rotates
// to keep the eye occupied without the harsh feel of a generic spinner.
// Caption underneath fades in/out on a slow loop so the screen feels
// alive even when the network is briefly idle.
export function LoadingScreen({
  message = "جاري التحميل...",
  inline = false,
  className,
}: LoadingScreenProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-background",
        !inline && "min-h-screen",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-6">
        <div className="relative flex items-center justify-center w-32 h-32">
          {/* Slowly rotating dashed ring — gives a sense of motion
              without the harshness of a spinning border. */}
          <div className="absolute inset-0 rounded-full border-2 border-dashed border-primary/30 animate-thiqa-spin-slow" />

          {/* Soft expanding pulse — radiates outward in a slow cycle. */}
          <div className="absolute inset-2 rounded-full bg-primary/10 animate-thiqa-loader-pulse" />

          {/* Logo plate — gently breathes (scale + opacity). */}
          <div className="relative w-20 h-20 rounded-full bg-background shadow-lg ring-1 ring-primary/15 flex items-center justify-center animate-thiqa-loader-breath">
            <img
              src={THIQA_LOGO_URL}
              alt="Thiqa"
              draggable={false}
              loading="eager"
              decoding="async"
              {...({ fetchpriority: "high" } as Record<string, string>)}
              className="h-12 w-12 object-contain"
            />
          </div>
        </div>

        <p className="text-sm font-medium tracking-wide text-muted-foreground animate-thiqa-loader-fade">
          {message}
        </p>
      </div>
    </div>
  );
}
