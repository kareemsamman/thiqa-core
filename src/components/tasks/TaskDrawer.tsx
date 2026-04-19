import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { CalendarIcon, Clock, User } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Task, CreateTaskInput } from "@/hooks/useTasks";
import { cn } from "@/lib/utils";

interface TaskDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  onSubmit: (data: CreateTaskInput) => void;
  isSubmitting?: boolean;
  defaultDate?: Date;
}

// Time options from 06:00 to 23:30 with 30-minute intervals
const TIME_OPTIONS = Array.from({ length: 36 }, (_, i) => {
  const hour = Math.floor(i / 2) + 6;
  const minutes = (i % 2) * 30;
  const timeStr = `${hour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  return { value: timeStr, label: timeStr };
});

// Get current time rounded down to nearest 30 minutes
function getCurrentTimeRounded(): string {
  const now = new Date();
  let hours = now.getHours();
  const minutes = now.getMinutes();
  
  // Round down to nearest 30 minutes
  const roundedMinutes = minutes < 30 ? 0 : 30;
  
  // Clamp to valid range (06:00 - 23:30)
  if (hours < 6) hours = 6;
  if (hours > 23) hours = 23;
  
  return `${hours.toString().padStart(2, '0')}:${roundedMinutes.toString().padStart(2, '0')}`;
}

export function TaskDrawer({
  open,
  onOpenChange,
  task,
  onSubmit,
  isSubmitting,
  defaultDate,
}: TaskDrawerProps) {
  const { user, profile } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState<Date | undefined>(defaultDate || new Date());
  const [dueTime, setDueTime] = useState("09:00");

  // Fetch active users using RPC to bypass RLS restrictions for workers
  const { data: users = [] } = useQuery({
    queryKey: ['active-users-for-tasks'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_active_users_for_tasks');
      if (error) throw error;
      return data || [];
    },
  });

  // Reset form when opening/closing or task changes
  useEffect(() => {
    if (open) {
      if (task) {
        setTitle(task.title);
        setDescription(task.description || "");
        setAssignedTo(task.assigned_to);
        setDueDate(new Date(task.due_date));
        setDueTime(task.due_time.slice(0, 5)); // HH:MM
      } else {
        setTitle("");
        setDescription("");
        setAssignedTo(user?.id || "");
        setDueDate(defaultDate || new Date());
        setDueTime(getCurrentTimeRounded());
      }
    }
  }, [open, task, user?.id, defaultDate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !assignedTo || !dueDate) return;

    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      assigned_to: assignedTo,
      due_date: format(dueDate, 'yyyy-MM-dd'),
      due_time: `${dueTime}:00`,
      branch_id: profile?.branch_id,
    });

    onOpenChange(false);
  };

  const getUserDisplayName = (u: { full_name: string | null; email: string }) => {
    return u.full_name || u.email.split('@')[0];
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-right">
            {task ? "تعديل المهمة" : "مهمة جديدة"}
          </SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">عنوان المهمة *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: مراجعة معاملة العميل"
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">التفاصيل (اختياري)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="أضف تفاصيل إضافية..."
              rows={3}
            />
          </div>

          {/* Assigned To */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <User className="h-4 w-4" />
              مسندة إلى *
            </Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الشخص" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {getUserDisplayName(u)}
                    {u.id === user?.id && " (أنت)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4" />
              التاريخ *
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-right",
                    !dueDate && "text-muted-foreground"
                  )}
                >
                  {dueDate ? (
                    format(dueDate, "EEEE, d MMMM yyyy", { locale: ar })
                  ) : (
                    <span>اختر التاريخ</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dueDate}
                  onSelect={setDueDate}
                  locale={ar}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Due Time */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              الوقت *
            </Label>
            <Select value={dueTime} onValueChange={setDueTime}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? "جاري الحفظ..." : task ? "حفظ التغييرات" : "إنشاء المهمة"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              إلغاء
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
