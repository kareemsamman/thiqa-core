import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Bell, 
  Check, 
  CheckCheck, 
  Trash2, 
  FileSignature, 
  ExternalLink,
  Loader2,
  Wallet,
  FileText,
  UserPlus,
  AlertTriangle,
  Clock,
  Search,
  Filter
} from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { PaymentMethodBadge } from '@/components/notifications/PaymentMethodBadge';
import { PaymentTypeBadges } from '@/components/notifications/PaymentTypeBadges';
import { PaymentDetailsPanel } from '@/components/notifications/PaymentDetailsPanel';
import { NewSinceLastVisitBanner } from '@/components/notifications/NewSinceLastVisitBanner';
import { formatDistanceToNow, format } from 'date-fns';
import { arDZ as ar } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

const NOTIFICATION_ICONS: Record<string, React.ReactNode> = {
  signature: <FileSignature className="h-5 w-5 text-emerald-500" />,
  payment: <Wallet className="h-5 w-5 text-blue-500" />,
  policy: <FileText className="h-5 w-5 text-purple-500" />,
  client: <UserPlus className="h-5 w-5 text-orange-500" />,
  expiring: <AlertTriangle className="h-5 w-5 text-amber-500" />,
  reminder: <Clock className="h-5 w-5 text-cyan-500" />,
  general: <Bell className="h-5 w-5 text-muted-foreground" />,
};

const NOTIFICATION_COLORS: Record<string, string> = {
  signature: 'bg-emerald-500/10 border-emerald-500/20',
  payment: 'bg-blue-500/10 border-blue-500/20',
  policy: 'bg-purple-500/10 border-purple-500/20',
  client: 'bg-orange-500/10 border-orange-500/20',
  expiring: 'bg-amber-500/10 border-amber-500/20',
  reminder: 'bg-cyan-500/10 border-cyan-500/20',
  general: 'bg-muted/50 border-border',
};

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  signature: 'توقيع',
  payment: 'دفعة',
  policy: 'وثيقة',
  client: 'عميل',
  expiring: 'تنبيه انتهاء',
  reminder: 'تذكير',
  general: 'عام',
};

export default function Notifications() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { 
    notifications, 
    unreadCount, 
    loading, 
    markAsRead, 
    markAllAsRead, 
    deleteNotification,
    deleteAllNotifications,
    newSinceLastSeen,
    updateLastSeen,
    recentlyArrivedIds
  } = useNotifications();
  
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showBanner, setShowBanner] = useState(true);
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Update last seen when visiting this page
  useEffect(() => {
    updateLastSeen();
  }, [updateLastSeen]);

  // Filtered notifications
  const filteredNotifications = useMemo(() => {
    return notifications.filter(notification => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = notification.title.toLowerCase().includes(query);
        const matchesMessage = notification.message.toLowerCase().includes(query);
        if (!matchesTitle && !matchesMessage) return false;
      }
      
      // Type filter
      if (typeFilter !== 'all' && notification.type !== typeFilter) {
        return false;
      }
      
      // Status filter
      if (statusFilter === 'unread' && notification.is_read) {
        return false;
      }
      if (statusFilter === 'read' && !notification.is_read) {
        return false;
      }
      
      return true;
    });
  }, [notifications, searchQuery, typeFilter, statusFilter]);

  const handleNotificationClick = async (notification: Notification) => {
    setSelectedNotification(notification);
    if (!notification.is_read) {
      await markAsRead(notification.id);
    }
  };

  const handleDelete = async (notificationId: string) => {
    setDeleting(notificationId);
    await deleteNotification(notificationId);
    if (selectedNotification?.id === notificationId) {
      setSelectedNotification(null);
    }
    setDeleting(null);
    toast({
      title: 'تم الحذف',
      description: 'تم حذف الإشعار بنجاح',
    });
  };

  const handleDeleteAll = async () => {
    await deleteAllNotifications();
    setSelectedNotification(null);
    setDeleteAllOpen(false);
    toast({
      title: 'تم الحذف',
      description: 'تم حذف جميع الإشعارات',
    });
  };

  const handleNavigate = (notification: Notification) => {
    if (notification.link) {
      navigate(notification.link);
    }
  };

  const formatTime = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: ar });
    } catch {
      return '';
    }
  };

  const formatFullDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'dd MMMM yyyy - HH:mm', { locale: ar });
    } catch {
      return '';
    }
  };

  // Get unique notification types for filter dropdown
  const availableTypes = useMemo(() => {
    const types = new Set(notifications.map(n => n.type));
    return Array.from(types);
  }, [notifications]);

  return (
    <MainLayout>
      <Header
        title="التنبيهات"
        subtitle="جميع التنبيهات والإشعارات"
      />

      <div className="p-6 space-y-6">
        {/* New since last visit banner */}
        {showBanner && newSinceLastSeen > 0 && (
          <NewSinceLastVisitBanner
            count={newSinceLastSeen}
            onDismiss={() => setShowBanner(false)}
          />
        )}

        {/* Search and Filters */}
        <Card className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            {unreadCount > 0 && (
              <Button size="sm" onClick={markAllAsRead} className="gap-2">
                <CheckCheck className="h-4 w-4" />
                قراءة الكل
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteAllOpen(true)}
                className="gap-2 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                حذف الكل
              </Button>
            )}

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث في الإشعارات..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10"
              />
            </div>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]">
                <Filter className="h-4 w-4 ml-2 text-muted-foreground" />
                <SelectValue placeholder="النوع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                {availableTypes.map(type => (
                  <SelectItem key={type} value={type}>
                    {NOTIFICATION_TYPE_LABELS[type] || type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="unread">غير مقروء</SelectItem>
                <SelectItem value="read">مقروء</SelectItem>
              </SelectContent>
            </Select>

            {(searchQuery || typeFilter !== 'all' || statusFilter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setTypeFilter('all');
                  setStatusFilter('all');
                }}
              >
                مسح الفلاتر
              </Button>
            )}
          </div>
          
          {filteredNotifications.length !== notifications.length && (
            <p className="text-sm text-muted-foreground mt-2">
              عرض <span className="ltr-nums">{filteredNotifications.length}</span> من <span className="ltr-nums">{notifications.length}</span> إشعار
            </p>
          )}
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Notifications List */}
          <div className="lg:col-span-2 space-y-3">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-2/3" />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : filteredNotifications.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Bell className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                  <h3 className="text-lg font-medium mb-2">
                    {notifications.length === 0 ? 'لا توجد إشعارات' : 'لا توجد نتائج'}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {notifications.length === 0 
                      ? 'ستظهر هنا الإشعارات عند حدوث أي نشاط'
                      : 'جرب تغيير معايير البحث أو الفلاتر'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              filteredNotifications.map((notification) => {
                const isRecentlyArrived = recentlyArrivedIds.has(notification.id);
                const isPayment = notification.type === 'payment';
                
                return (
                  <Card 
                    key={notification.id}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md",
                      selectedNotification?.id === notification.id && 'ring-2 ring-primary',
                      !notification.is_read && (NOTIFICATION_COLORS[notification.type] || NOTIFICATION_COLORS.general),
                      isRecentlyArrived && 'animate-in slide-in-from-top-2 duration-300 ring-2 ring-primary/50'
                    )}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className={cn(
                          "p-2 rounded-full",
                          NOTIFICATION_COLORS[notification.type] || NOTIFICATION_COLORS.general
                        )}>
                          {NOTIFICATION_ICONS[notification.type] || NOTIFICATION_ICONS.general}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className={cn(
                              "font-medium",
                              !notification.is_read ? 'text-foreground' : 'text-muted-foreground'
                            )}>
                              {notification.title}
                            </h3>
                            {!notification.is_read && (
                              <Badge variant="default" className="text-[10px] px-1.5 py-0">
                                جديد
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {notification.message}
                          </p>
                          
                        {/* Payment badges for payment notifications */}
                        {notification.type === 'payment' && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            <PaymentMethodBadge metadata={notification.metadata} />
                            <PaymentTypeBadges metadata={notification.metadata} />
                          </div>
                        )}
                          
                          <p className="text-xs text-muted-foreground mt-2">
                            {formatTime(notification.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {!notification.is_read && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                markAsRead(notification.id);
                              }}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            disabled={deleting === notification.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(notification.id);
                            }}
                          >
                            {deleting === notification.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Notification Details */}
          <div className="lg:col-span-1">
            <Card className="sticky top-20">
              <CardHeader>
                <CardTitle className="text-lg">تفاصيل الإشعار</CardTitle>
              </CardHeader>
              <CardContent>
                {selectedNotification ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "p-3 rounded-full",
                        NOTIFICATION_COLORS[selectedNotification.type] || NOTIFICATION_COLORS.general
                      )}>
                        {NOTIFICATION_ICONS[selectedNotification.type] || NOTIFICATION_ICONS.general}
                      </div>
                      <div>
                        <h3 className="font-semibold">{selectedNotification.title}</h3>
                        <p className="text-xs text-muted-foreground">
                          {formatFullDate(selectedNotification.created_at)}
                        </p>
                      </div>
                    </div>
                    
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <p className="text-sm leading-relaxed">{selectedNotification.message}</p>
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">النوع:</span>
                        <Badge variant="outline">
                          {NOTIFICATION_TYPE_LABELS[selectedNotification.type] || 'عام'}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">الحالة:</span>
                        <Badge variant={selectedNotification.is_read ? 'secondary' : 'default'}>
                          {selectedNotification.is_read ? 'مقروء' : 'غير مقروء'}
                        </Badge>
                      </div>
                      
                      {selectedNotification.read_at && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">تمت القراءة:</span>
                          <span className="text-xs">{formatFullDate(selectedNotification.read_at)}</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Payment details panel */}
                    {selectedNotification.type === 'payment' && selectedNotification.metadata && (
                      <>
                        <div className="border-t my-4" />
                        <PaymentDetailsPanel metadata={selectedNotification.metadata} />
                      </>
                    )}

                    {selectedNotification.link && (
                      <Button 
                        className="w-full gap-2" 
                        onClick={() => handleNavigate(selectedNotification)}
                      >
                        <ExternalLink className="h-4 w-4" />
                        الانتقال للتفاصيل
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">اختر إشعار لعرض تفاصيله</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Delete All Dialog */}
      <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف جميع الإشعارات</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف جميع الإشعارات؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف الكل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
