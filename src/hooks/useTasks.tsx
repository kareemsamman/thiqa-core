import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  created_by: string;
  assigned_to: string;
  due_date: string;
  due_time: string;
  status: 'pending' | 'completed' | 'cancelled';
  reminder_shown: boolean;
  completed_at: string | null;
  completed_by: string | null;
  branch_id: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  creator?: { id: string; full_name: string | null; email: string };
  assignee?: { id: string; full_name: string | null; email: string };
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  assigned_to: string;
  due_date: string;
  due_time: string;
  branch_id?: string | null;
}

export function useTasks(selectedDate?: Date) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');

  // Fetch tasks for selected date + overdue pending tasks from previous days
  const { data: tasks = [], isLoading, refetch } = useQuery({
    queryKey: ['tasks', dateStr, user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      // Use new RPC that includes pending tasks from previous days
      const { data, error } = await supabase.rpc('get_tasks_with_users_and_pending', {
        target_date: dateStr
      });

      if (error) throw error;
      
      // Transform flat RPC response to nested format matching Task interface
      return (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        created_by: row.created_by,
        assigned_to: row.assigned_to,
        due_date: row.due_date,
        due_time: row.due_time,
        status: row.status,
        reminder_shown: row.reminder_shown,
        completed_at: row.completed_at,
        completed_by: row.completed_by,
        branch_id: row.branch_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        creator: row.creator_id ? { 
          id: row.creator_id, 
          full_name: row.creator_full_name, 
          email: row.creator_email 
        } : null,
        assignee: row.assignee_id ? { 
          id: row.assignee_id, 
          full_name: row.assignee_full_name, 
          email: row.assignee_email 
        } : null,
        isOverdue: row.is_overdue || false,
      })) as (Task & { isOverdue?: boolean })[];
    },
    enabled: !!user?.id,
  });

  // Fetch ALL pending tasks count for badge (including overdue from previous days)
  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['tasks-pending-count', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const today = format(new Date(), 'yyyy-MM-dd');
      
      // Count all pending tasks up to and including today (overdue + today's)
      const { count, error } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .lte('due_date', today)
        .eq('status', 'pending')
        .eq('assigned_to', user.id);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!user?.id,
  });

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          ...input,
          created_by: user.id,
          branch_id: input.branch_id || profile?.branch_id || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks-pending-count'] });
      toast({ title: "تم إنشاء المهمة بنجاح" });
    },
    onError: (error) => {
      toast({ title: "خطأ في إنشاء المهمة", description: error.message, variant: "destructive" });
    },
  });

  // Update task mutation
  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Task> & { id: string }) => {
      const { data, error } = await supabase
        .from('tasks')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks-pending-count'] });
    },
    onError: (error) => {
      toast({ title: "خطأ في تحديث المهمة", description: error.message, variant: "destructive" });
    },
  });

  // Complete task
  const completeTask = useCallback(async (taskId: string) => {
    if (!user?.id) return;
    
    await updateTaskMutation.mutateAsync({
      id: taskId,
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: user.id,
    });
    
    toast({ title: "تم إنجاز المهمة ✓" });
  }, [user?.id, updateTaskMutation, toast]);

  // Delete task mutation
  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks-pending-count'] });
      toast({ title: "تم حذف المهمة" });
    },
    onError: (error) => {
      toast({ title: "خطأ في حذف المهمة", description: error.message, variant: "destructive" });
    },
  });

  // Mark reminder as shown
  const markReminderShown = useCallback(async (taskId: string) => {
    await supabase
      .from('tasks')
      .update({ reminder_shown: true })
      .eq('id', taskId);
  }, []);

  // Realtime subscription
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('tasks-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
        },
        () => {
          refetch();
          queryClient.invalidateQueries({ queryKey: ['tasks-pending-count'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, refetch, queryClient]);

  // Computed stats
  const stats = {
    pending: tasks.filter(t => t.status === 'pending').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    overdue: tasks.filter(t => {
      if (t.status !== 'pending') return false;
      const now = new Date();
      const dueDateTime = new Date(`${t.due_date}T${t.due_time}`);
      return dueDateTime < now;
    }).length,
  };

  return {
    tasks,
    isLoading,
    pendingCount,
    stats,
    refetch,
    createTask: createTaskMutation.mutate,
    updateTask: updateTaskMutation.mutate,
    completeTask,
    deleteTask: deleteTaskMutation.mutate,
    markReminderShown,
    isCreating: createTaskMutation.isPending,
    isUpdating: updateTaskMutation.isPending,
    isDeleting: deleteTaskMutation.isPending,
  };
}

// Hook for checking due tasks (for popup reminder)
export function useDueTasksChecker() {
  const { user } = useAuth();
  const [dueTask, setDueTask] = useState<Task | null>(null);
  const queryClient = useQueryClient();

  const checkDueTasks = useCallback(async () => {
    if (!user?.id) return;

    const now = new Date();
    const today = format(now, 'yyyy-MM-dd');
    const currentTime = format(now, 'HH:mm:ss');

    const { data } = await supabase
      .from('tasks')
      .select(`
        *,
        creator:profiles!tasks_created_by_fkey(id, full_name, email)
      `)
      .eq('due_date', today)
      .eq('status', 'pending')
      .eq('reminder_shown', false)
      .eq('assigned_to', user.id)
      .lte('due_time', currentTime)
      .order('due_time', { ascending: true })
      .limit(1);

    if (data && data.length > 0) {
      setDueTask(data[0] as Task);
    }
  }, [user?.id]);

  const dismissTask = useCallback(async () => {
    if (dueTask) {
      await supabase
        .from('tasks')
        .update({ reminder_shown: true })
        .eq('id', dueTask.id);
      setDueTask(null);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  }, [dueTask, queryClient]);

  const completeAndDismiss = useCallback(async () => {
    if (dueTask && user?.id) {
      await supabase
        .from('tasks')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: user.id,
          reminder_shown: true,
        })
        .eq('id', dueTask.id);
      setDueTask(null);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks-pending-count'] });
    }
  }, [dueTask, user?.id, queryClient]);

  useEffect(() => {
    if (!user?.id) return;
    
    // Check immediately
    checkDueTasks();
    
    // Then check every 30 seconds
    const interval = setInterval(checkDueTasks, 30000);
    
    return () => clearInterval(interval);
  }, [user?.id, checkDueTasks]);

  return { dueTask, dismissTask, completeAndDismiss };
}
