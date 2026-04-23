import { Bot, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThaqibButtonProps {
  onClick: () => void;
  visible: boolean;
  /** When true, renders an amber "AI quota exhausted" variant with a
   *  small lock badge. Clicking still fires onClick (the widget uses
   *  that to open the upgrade dialog). */
  locked?: boolean;
}

export function ThaqibButton({ onClick, visible, locked = false }: ThaqibButtonProps) {
  return (
    <button
      onClick={onClick}
      // NOTE: keep `fixed` the only position utility in this list —
      // tailwind-merge will strip earlier position utilities if a later
      // string also sets one (e.g. `relative`). `fixed` already creates
      // a positioning context for the absolutely-positioned lock badge
      // inside, so `relative` isn't needed.
      className={cn(
        "fixed bottom-28 left-4 md:bottom-4 md:left-12 z-50 h-14 w-14 md:h-16 md:w-16 rounded-full shadow-xl",
        "flex items-center justify-center transition-all duration-300",
        "hover:scale-110 active:scale-95",
        locked
          ? "bg-amber-500 hover:bg-amber-400 text-white ring-2 ring-amber-300/60"
          : "bg-black hover:bg-neutral-800 text-white ring-1 ring-white/10",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
      )}
      title={locked ? "المساعد الذكي (ثاقب) — اضغط للترقية" : "ثاقب — المساعد الذكي"}
    >
      <Bot className="h-6 w-6 md:h-7 md:w-7" />
      {locked && (
        <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-white text-amber-600 flex items-center justify-center ring-2 ring-amber-500">
          <Lock className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}
