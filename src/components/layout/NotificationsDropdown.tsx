import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Bell, 
  Check, 
  CheckCheck, 
  Trash2, 
  FileSignature, 
  Loader2,
  Wallet,
  FileText,
  UserPlus,
  AlertTriangle,
  Clock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { PaymentMethodBadge } from '@/components/notifications/PaymentMethodBadge';
import { PaymentTypeBadges } from '@/components/notifications/PaymentTypeBadges';
import { formatDistanceToNow } from 'date-fns';
import { arDZ as ar } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const NOTIFICATION_ICONS: Record<string, React.ReactNode> = {
  signature: <FileSignature className="h-4 w-4 text-emerald-500" />,
  payment: <Wallet className="h-4 w-4 text-blue-500" />,
  policy: <FileText className="h-4 w-4 text-purple-500" />,
  client: <UserPlus className="h-4 w-4 text-orange-500" />,
  expiring: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  reminder: <Clock className="h-4 w-4 text-cyan-500" />,
  general: <Bell className="h-4 w-4 text-muted-foreground" />,
};

const NOTIFICATION_COLORS: Record<string, string> = {
  signature: 'bg-emerald-500/10',
  payment: 'bg-blue-500/10',
  policy: 'bg-purple-500/10',
  client: 'bg-orange-500/10',
  expiring: 'bg-amber-500/10',
  reminder: 'bg-cyan-500/10',
  general: 'bg-muted/50',
};

export function NotificationsDropdown() {
  const navigate = useNavigate();
  const { 
    notifications, 
    unreadCount, 
    loading, 
    markAsRead, 
    markAllAsRead, 
    deleteNotification,
    recentlyArrivedIds,
    badgePulse
  } = useNotifications();
  const [open, setOpen] = useState(false);

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.is_read) {
      await markAsRead(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
      setOpen(false);
    }
  };

  const formatTime = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: ar });
    } catch {
      return '';
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className={cn(
            "relative h-9 w-9 md:h-10 md:w-10",
            badgePulse && "animate-pulse"
          )}
        >
          <Bell className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground" />
          {unreadCount > 0 && (
            <Badge 
              className={cn(
                "absolute -left-1 -top-1 h-5 w-5 rounded-full p-0 text-[10px] flex items-center justify-center border-2 border-background",
                badgePulse && "ring-2 ring-destructive/50"
              )}
              variant="destructive"
            >
              <span className="ltr-nums">{unreadCount > 99 ? '99+' : unreadCount}</span>
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        align="end" 
        className="w-[360px] md:w-[400px] p-0 shadow-xl border-border/50"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-muted/30">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">الإشعارات</h3>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                <span className="ltr-nums">{unreadCount}</span> جديد
              </Badge>
            )}
          </div>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 text-xs gap-1.5 text-primary hover:text-primary"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                markAllAsRead();
              }}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              قراءة الكل
            </Button>
          )}
        </div>
        
        <Separator />
        
        {/* Content */}
        <ScrollArea className="h-[350px] md:h-[420px]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <div className="p-4 rounded-full bg-muted/50 mb-4">
                <Bell className="h-10 w-10 opacity-30" />
              </div>
              <p className="text-sm font-medium">لا توجد إشعارات</p>
              <p className="text-xs text-muted-foreground mt-1">ستظهر الإشعارات الجديدة هنا</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {notifications.map((notification) => {
                const isRecentlyArrived = recentlyArrivedIds.has(notification.id);
                const isPayment = notification.type === 'payment';
                
                return (
                  <div
                    key={notification.id}
                    className={cn(
                      "group p-4 hover:bg-muted/50 cursor-pointer transition-all duration-200",
                      !notification.is_read && 'bg-primary/5',
                      isRecentlyArrived && 'animate-in slide-in-from-top-2 duration-300 bg-primary/10'
                    )}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div className={cn(
                        "p-2.5 rounded-full flex-shrink-0",
                        NOTIFICATION_COLORS[notification.type] || NOTIFICATION_COLORS.general
                      )}>
                        {NOTIFICATION_ICONS[notification.type] || NOTIFICATION_ICONS.general}
                      </div>
                      
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <p className={cn(
                            "text-sm font-medium leading-tight",
                            !notification.is_read ? 'text-foreground' : 'text-muted-foreground'
                          )}>
                            {notification.title}
                          </p>
                          {!notification.is_read && (
                            <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                              جديد
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {notification.message}
                        </p>
                        
                        {/* Payment badges for payment notifications */}
                        {isPayment && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <PaymentMethodBadge metadata={notification.metadata} />
                            <PaymentTypeBadges metadata={notification.metadata} />
                          </div>
                        )}
                        
                        <p className="text-[11px] text-muted-foreground/70 mt-1.5">
                          {formatTime(notification.created_at)}
                        </p>
                      </div>
                      
                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!notification.is_read && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              markAsRead(notification.id);
                            }}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNotification(notification.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        
        {/* Footer */}
        {notifications.length > 0 && (
          <>
            <Separator />
            <div className="p-2">
              <Button
                variant="ghost"
                className="w-full h-9 text-sm text-primary hover:text-primary hover:bg-primary/10"
                onClick={() => {
                  navigate('/notifications');
                  setOpen(false);
                }}
              >
                عرض جميع الإشعارات
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
