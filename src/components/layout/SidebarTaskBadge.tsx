import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface SidebarTaskBadgeProps {
  collapsed?: boolean;
}

export function SidebarTaskBadge({ collapsed }: SidebarTaskBadgeProps) {
  const { user } = useAuth();

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['tasks-pending-count-sidebar', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const today = format(new Date(), 'yyyy-MM-dd');
      
      const { count, error } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('due_date', today)
        .eq('status', 'pending')
        .eq('assigned_to', user.id);

      if (error) return 0;
      return count || 0;
    },
    enabled: !!user?.id,
    refetchInterval: 60000, // Refresh every minute
  });

  if (pendingCount === 0) return null;

  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-full text-xs font-bold",
        "bg-violet-500 text-white",
        collapsed
          ? "absolute -top-1 -left-1 h-4 w-4 text-[10px]"
          : "h-5 min-w-[20px] px-1.5 mr-auto"
      )}
    >
      {pendingCount > 99 ? "99+" : pendingCount}
    </span>
  );
}
