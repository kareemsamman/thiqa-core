import { useNavigate, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { useRecentClient } from '@/hooks/useRecentClient';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface RecentClientBubbleProps {
  currentlyViewingClientId?: string | null;
}

export function RecentClientBubble({ currentlyViewingClientId }: RecentClientBubbleProps) {
  const { recentClient, clearRecentClient } = useRecentClient();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Don't show if no recent client
  if (!recentClient) return null;
  
  // Don't show if we're currently viewing this client's details
  if (currentlyViewingClientId === recentClient.id) return null;
  
  // Don't show on clients page (since client details replaces the page there)
  const isOnClientsPage = location.pathname === '/clients';
  if (isOnClientsPage) return null;

  const handleClick = () => {
    navigate(`/clients/${recentClient.id}`);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearRecentClient();
  };

  return (
    <div className="fixed bottom-20 left-4 z-40 animate-fade-in">
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className={cn(
              "relative cursor-pointer group",
              "flex items-center gap-2 pr-2 pl-4 py-2 rounded-full",
              "bg-primary text-primary-foreground shadow-lg",
              "hover:scale-105 transition-transform duration-200"
            )}
            onClick={handleClick}
          >
            {/* Avatar */}
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-foreground/20">
              <span className="text-sm font-bold text-primary-foreground">
                {recentClient.initial}
              </span>
            </div>
            
            {/* Name - visible on larger screens */}
            <span className="hidden sm:block text-sm font-medium max-w-24 truncate">
              {recentClient.name}
            </span>
            
            {/* Close button */}
            <button
              onClick={handleClose}
              className={cn(
                "flex items-center justify-center h-5 w-5 rounded-full",
                "bg-primary-foreground/20 hover:bg-primary-foreground/30",
                "opacity-0 group-hover:opacity-100 transition-opacity"
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>العودة لملف {recentClient.name}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
