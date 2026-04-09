import { useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NewSinceLastVisitBannerProps {
  count: number;
  onDismiss: () => void;
}

export function NewSinceLastVisitBanner({ count, onDismiss }: NewSinceLastVisitBannerProps) {
  // Auto-dismiss after 10 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, 10000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (count <= 0) return null;

  return (
    <div 
      className={cn(
        "flex items-center justify-between gap-3 p-3 mb-4 rounded-lg",
        "bg-primary/10 border border-primary/20 text-primary",
        "animate-in slide-in-from-top-2 duration-300"
      )}
    >
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4" />
        <span className="text-sm font-medium">
          لديك <span className="ltr-nums font-bold">{count}</span> إشعارات جديدة منذ آخر زيارة
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-primary hover:text-primary/80"
        onClick={onDismiss}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
