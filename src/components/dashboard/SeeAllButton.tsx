import { Button } from "@/components/ui/button";
import { ChevronLeft, Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface SeeAllButtonProps {
  locked?: boolean;
  onClick: () => void;
  label?: string;
  title?: string;
  className?: string;
}

/**
 * Unified "عرض الكل" trigger used across dashboard cards.
 * Unlocked variant: ghost pill with a back-chevron.
 * Locked variant:   amber outline with Lock + Sparkles, matching the
 *                   header's "معاملة جديدة" locked treatment so the
 *                   visual language of "this is behind a paywall" is
 *                   the same everywhere.
 */
export function SeeAllButton({
  locked,
  onClick,
  label = "عرض الكل",
  title,
  className,
}: SeeAllButtonProps) {
  if (locked) {
    return (
      <Button
        onClick={onClick}
        variant="outline"
        size="sm"
        title={title ?? "هذه الميزة غير متاحة في باقتك — اضغط للترقية"}
        className={cn(
          "h-9 px-3 rounded-full gap-1.5 border-amber-500/40 text-amber-700",
          "dark:text-amber-300 hover:bg-amber-500/10 active:scale-[0.98] text-sm",
          className
        )}
      >
        <Lock className="h-3.5 w-3.5" />
        <span>{label}</span>
        <Sparkles className="h-3 w-3 opacity-70" />
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("text-primary gap-1 h-9", className)}
      onClick={onClick}
    >
      {label}
      <ChevronLeft className="h-4 w-4" />
    </Button>
  );
}
