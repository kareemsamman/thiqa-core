import { useNotifications } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';

interface SidebarNotificationBadgeProps {
  collapsed?: boolean;
}

export function SidebarNotificationBadge({ collapsed }: SidebarNotificationBadgeProps) {
  const { unreadCount, badgePulse } = useNotifications();

  if (unreadCount === 0) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium",
        collapsed ? "absolute -top-1 -left-1 h-4 w-4 min-w-4" : "h-5 min-w-5 px-1.5 mr-auto",
        badgePulse && "animate-pulse ring-2 ring-destructive/50"
      )}
    >
      <span className="ltr-nums">{unreadCount > 99 ? '99+' : unreadCount}</span>
    </span>
  );
}
