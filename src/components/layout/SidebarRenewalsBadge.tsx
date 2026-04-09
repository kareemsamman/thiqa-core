import { useRenewalsCount } from '@/hooks/useRenewalsCount';
import { cn } from '@/lib/utils';

export function SidebarRenewalsBadge({ collapsed }: { collapsed?: boolean }) {
  const { renewalsCount, isLoading } = useRenewalsCount();

  if (isLoading || renewalsCount === 0) return null;

  return (
    <span className={cn(
      "inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-medium",
      collapsed 
        ? "absolute -top-1 -left-1 h-4 w-4 min-w-4" 
        : "h-5 min-w-5 px-1.5 mr-auto"
    )}>
      <span className="ltr-nums">{renewalsCount > 99 ? '99+' : renewalsCount}</span>
    </span>
  );
}
