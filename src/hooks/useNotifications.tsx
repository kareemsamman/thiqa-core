import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

// Payment cheque details
export interface PaymentChequeDetails {
  number?: string;
  due_date?: string;
  bank_name?: string;
}

// Payment installment details
export interface PaymentInstallmentDetails {
  index?: number;
  total?: number;
}

// Structured payment details inside metadata
export interface PaymentDetails {
  payment_id?: string;
  policy_id?: string | null;
  client_id?: string;
  client_name?: string;
  amount?: number;
  currency?: string;
  method?: 'cash' | 'cheque' | 'visa' | 'transfer';
  type?: 'premium' | 'renewal' | 'settlement' | 'commission' | 'debt_payment' | 'refund' | 'installment' | 'other';
  type_labels?: string[];
  reference?: string | null;
  notes?: string | null;
  cheque?: PaymentChequeDetails | null;
  installment?: PaymentInstallmentDetails | null;
}

export interface NotificationMetadata {
  // Legacy flat fields for backward compatibility
  payment_method?: 'cash' | 'cheque' | 'visa' | 'transfer';
  amount?: number;
  client_name?: string;
  payment_id?: string;
  reference?: string;
  // New structured payment object
  payment?: PaymentDetails;
  [key: string]: unknown;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
  metadata: NotificationMetadata | null;
}

// Payment method Arabic labels
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'نقدًا',
  cheque: 'شيك',
  visa: 'فيزا',
  transfer: 'حوالة/تحويل',
};

// Payment type Arabic labels
export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  premium: 'قسط',
  renewal: 'تجديد',
  settlement: 'تسوية شركة',
  commission: 'عمولة',
  debt_payment: 'تسديد دين',
  refund: 'استرجاع',
  installment: 'قسط (دفعة)',
  other: 'دفعة أخرى',
};

// Helper to get payment method from notification (supports both old and new structure)
export function getPaymentMethod(metadata: NotificationMetadata | null): 'cash' | 'cheque' | 'visa' | 'transfer' | undefined {
  if (!metadata) return undefined;
  // New structure first
  if (metadata.payment?.method) return metadata.payment.method;
  // Fallback to legacy
  return metadata.payment_method;
}

// Helper to get payment type labels from notification
export function getPaymentTypeLabels(metadata: NotificationMetadata | null): string[] {
  if (!metadata) return ['دفعة'];
  
  // If we have type_labels array, use it
  if (metadata.payment?.type_labels && metadata.payment.type_labels.length > 0) {
    return metadata.payment.type_labels;
  }
  
  // If we have a type, map it
  if (metadata.payment?.type) {
    return [PAYMENT_TYPE_LABELS[metadata.payment.type] || 'دفعة'];
  }
  
  // Default fallback
  return ['دفعة'];
}

// Helper to get payment details from notification
export function getPaymentDetails(metadata: NotificationMetadata | null): PaymentDetails | null {
  if (!metadata) return null;
  
  // If we have the new structured payment object
  if (metadata.payment) {
    return metadata.payment;
  }
  
  // Build from legacy flat fields
  if (metadata.payment_method || metadata.amount || metadata.client_name) {
    return {
      method: metadata.payment_method,
      amount: metadata.amount,
      client_name: metadata.client_name,
      payment_id: metadata.payment_id,
      reference: metadata.reference,
    };
  }
  
  return null;
}

// Notification sound URL (using a free notification sound)
const NOTIFICATION_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [newSinceLastSeen, setNewSinceLastSeen] = useState(0);
  const [recentlyArrivedIds, setRecentlyArrivedIds] = useState<Set<string>>(new Set());
  const [badgePulse, setBadgePulse] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Track shown toast IDs to prevent duplicates
  const shownToastIdsRef = useRef<Set<string>>(new Set());

  // Initialize audio element
  useEffect(() => {
    audioRef.current = new Audio(NOTIFICATION_SOUND_URL);
    audioRef.current.volume = 0.5;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const playNotificationSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(err => {
        // Browser may block autoplay, that's ok
        console.log('Could not play notification sound:', err);
      });
    }
  }, []);

  // Fetch last_seen_notifications_at from profile
  const fetchLastSeen = useCallback(async () => {
    if (!user) return null;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('last_seen_notifications_at')
        .eq('id', user.id)
        .single();
      
      if (error) throw error;
      return data?.last_seen_notifications_at || null;
    } catch (error) {
      console.error('Error fetching last seen:', error);
      return null;
    }
  }, [user]);

  // Update last_seen_notifications_at
  const updateLastSeen = useCallback(async () => {
    if (!user) return;
    
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('profiles')
        .update({ last_seen_notifications_at: now })
        .eq('id', user.id);
      
      if (error) throw error;
      setLastSeenAt(now);
      setNewSinceLastSeen(0);
    } catch (error) {
      console.error('Error updating last seen:', error);
    }
  }, [user]);

  const fetchNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    try {
      // Fetch last seen timestamp
      const lastSeen = await fetchLastSeen();
      setLastSeenAt(lastSeen);

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Cast metadata properly from Json to NotificationMetadata
      const notifs = (data || []).map(n => ({
        ...n,
        metadata: n.metadata as NotificationMetadata | null
      })) as Notification[];
      setNotifications(notifs);
      setUnreadCount(notifs.filter(n => !n.is_read).length);
      
      // Calculate new since last seen
      if (lastSeen) {
        const newCount = notifs.filter(n => new Date(n.created_at) > new Date(lastSeen)).length;
        setNewSinceLastSeen(newCount);
        if (newCount > 0) {
          // Trigger badge pulse once on load
          setBadgePulse(true);
          setTimeout(() => setBadgePulse(false), 2000);
        }
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [user, fetchLastSeen]);

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
      // Remove from recently arrived
      setRecentlyArrivedIds(prev => {
        const next = new Set(prev);
        next.delete(notificationId);
        return next;
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;
    
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (error) throw error;

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() })));
      setUnreadCount(0);
      setRecentlyArrivedIds(new Set());
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      const notification = notifications.find(n => n.id === notificationId);
      
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      if (notification && !notification.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
      setRecentlyArrivedIds(prev => {
        const next = new Set(prev);
        next.delete(notificationId);
        return next;
      });
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const deleteAllNotifications = async () => {
    if (!user) return;
    
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;

      setNotifications([]);
      setUnreadCount(0);
      setRecentlyArrivedIds(new Set());
    } catch (error) {
      console.error('Error deleting all notifications:', error);
    }
  };

  // Clear recently arrived status after 10 seconds
  const clearRecentlyArrived = useCallback((id: string) => {
    setTimeout(() => {
      setRecentlyArrivedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 10000);
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('notifications-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const rawNotification = payload.new as Notification;
          // Cast metadata properly
          const newNotification: Notification = {
            ...rawNotification,
            metadata: rawNotification.metadata as NotificationMetadata | null
          };
          
          // Always add to the list
          setNotifications(prev => {
            // Dedupe check - don't add if already exists
            if (prev.some(n => n.id === newNotification.id)) {
              return prev;
            }
            return [newNotification, ...prev];
          });
          
          // ONLY show toast/sound/pulse for UNREAD notifications
          const isUnread = !newNotification.is_read && !newNotification.read_at;
          
          if (isUnread) {
            // Check if we've already shown a toast for this notification (dedupe)
            if (shownToastIdsRef.current.has(newNotification.id)) {
              return;
            }
            shownToastIdsRef.current.add(newNotification.id);
            
            // Update unread count
            setUnreadCount(prev => prev + 1);
            
            // Mark as recently arrived for animation
            setRecentlyArrivedIds(prev => new Set(prev).add(newNotification.id));
            clearRecentlyArrived(newNotification.id);
            
            // Trigger badge pulse
            setBadgePulse(true);
            setTimeout(() => setBadgePulse(false), 2000);
            
            // Play sound
            playNotificationSound();
            
            // Show toast notification
            toast(newNotification.title, {
              description: newNotification.message,
              action: newNotification.link ? {
                label: 'عرض',
                onClick: () => {
                  window.location.href = newNotification.link!;
                },
              } : undefined,
              duration: 5000,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, playNotificationSound, clearRecentlyArrived]);

  return {
    notifications,
    unreadCount,
    loading,
    lastSeenAt,
    newSinceLastSeen,
    recentlyArrivedIds,
    badgePulse,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteAllNotifications,
    updateLastSeen,
    refetch: fetchNotifications,
  };
}
