import { useAccidentReportsCount } from '@/hooks/useAccidentReportsCount';
import { cn } from '@/lib/utils';

interface SidebarAccidentsBadgeProps {
  collapsed?: boolean;
}

export function SidebarAccidentsBadge({ collapsed }: SidebarAccidentsBadgeProps) {
  const { count, isLoading } = useAccidentReportsCount();

  if (isLoading || count === 0) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium",
        collapsed ? "absolute -top-1 -left-1 h-4 w-4 min-w-4" : "h-5 min-w-5 px-1.5 mr-auto"
      )}
    >
      <span className="ltr-nums">{count > 99 ? '99+' : count}</span>
    </span>
  );
}
