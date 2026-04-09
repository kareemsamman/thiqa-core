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
        "fixed bottom-20 left-4 z-50 h-12 w-12 rounded-full shadow-lg",
        "bg-[#122143] hover:bg-[#1a3260] text-white",
        "flex items-center justify-center transition-all duration-300",
        "hover:scale-110 active:scale-95",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
      )}
      title="ثاقب — المساعد الذكي"
    >
      <Bot className="h-5 w-5" />
    </button>
  );
}
