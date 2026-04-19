import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThaqibButtonProps {
  onClick: () => void;
  visible: boolean;
}

export function ThaqibButton({ onClick, visible }: ThaqibButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "fixed bottom-28 left-4 md:bottom-4 md:left-12 z-50 h-14 w-14 md:h-16 md:w-16 rounded-full shadow-xl",
        "bg-black hover:bg-neutral-800 text-white ring-1 ring-white/10",
        "flex items-center justify-center transition-all duration-300",
        "hover:scale-110 active:scale-95",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
      )}
      title="ثاقب — المساعد الذكي"
    >
      <Bot className="h-6 w-6 md:h-7 md:w-7" />
    </button>
  );
}
