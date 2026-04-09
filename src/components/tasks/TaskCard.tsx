import { useState } from "react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import {
  Clock,
  Check,
  MoreVertical,
  User,
  ArrowLeft,
  Trash2,
  Edit,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Task } from "@/hooks/useTasks";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: Task & { isOverdue?: boolean };
  onComplete: (id: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
}

export function TaskCard({ task, onComplete, onEdit, onDelete }: TaskCardProps) {
  const { user } = useAuth();
  const [completing, setCompleting] = useState(false);

  const isOverdue = () => {
    if (task.status !== 'pending') return false;
    const now = new Date();
    const dueDateTime = new Date(`${task.due_date}T${task.due_time}`);
    return dueDateTime < now;
  };

  const isCompleted = task.status === 'completed';
  const overdue = isOverdue();

  const creatorName = task.creator?.full_name || task.creator?.email?.split('@')[0] || 'غير معروف';
  const assigneeName = task.assignee?.full_name || task.assignee?.email?.split('@')[0] || 'غير معروف';
  const isAssignedToMe = task.assigned_to === user?.id;
  const isCreatedByMe = task.created_by === user?.id;

  const handleComplete = async () => {
    setCompleting(true);
    await onComplete(task.id);
    setCompleting(false);
  };

  const formatTime = (time: string) => {
    return time.slice(0, 5); // HH:MM
  };

  return (
    <Card
      className={cn(
        "transition-all duration-200 hover:shadow-lg group",
        isCompleted && "opacity-60 bg-muted/20",
        overdue && "border-r-4 border-r-destructive bg-destructive/5",
        !isCompleted && !overdue && "border-r-4 border-r-primary/30"
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Time badge */}
          <div
            className={cn(
              "flex flex-col items-center justify-center min-w-[70px] py-3 px-3 rounded-xl shadow-sm",
              isCompleted
                ? "bg-green-50 text-green-700 border border-green-200"
                : overdue
                ? "bg-red-50 text-red-600 border border-red-200"
                : "bg-primary/5 text-primary border border-primary/20"
            )}
          >
            <Clock className="h-4 w-4 mb-1" />
            <span className="text-base font-bold font-mono ltr-nums">
              {formatTime(task.due_time)}
            </span>
            {/* Show date for overdue tasks */}
            {(task.isOverdue || overdue) && (
              <span className="text-[10px] mt-0.5 opacity-75 font-medium">
                {format(new Date(task.due_date), 'd/M')}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <h4
                  className={cn(
                    "font-medium text-base leading-tight",
                    isCompleted && "line-through text-muted-foreground"
                  )}
                >
                  {task.title}
                </h4>
                {task.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {task.description}
                  </p>
                )}
              </div>

              {/* Status badges */}
              <div className="flex items-center gap-1">
                {overdue && (
                  <Badge variant="destructive" className="text-xs">
                    <AlertCircle className="h-3 w-3 ml-1" />
                    متأخر
                  </Badge>
                )}
                {isCompleted && (
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                    <Check className="h-3 w-3 ml-1" />
                    منجز
                  </Badge>
                )}
              </div>
            </div>

            {/* Assignment info with better styling */}
            <div className="flex items-center gap-2 mt-3">
              <div className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs",
                isCreatedByMe && !isAssignedToMe 
                  ? "bg-violet-100 text-violet-700" 
                  : "bg-muted text-muted-foreground"
              )}>
                <User className="h-3 w-3" />
                {isCreatedByMe && isAssignedToMe ? (
                  <span>مهمة شخصية</span>
                ) : isCreatedByMe ? (
                  <span className="flex items-center gap-1">
                    <ArrowLeft className="h-3 w-3" />
                    {assigneeName}
                  </span>
                ) : (
                  <span>من: {creatorName}</span>
                )}
              </div>
            </div>

            {/* Completed info */}
            {isCompleted && task.completed_at && (
              <div className="text-xs text-muted-foreground mt-1">
                أُنجز في {format(new Date(task.completed_at), "HH:mm", { locale: ar })}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            {!isCompleted && (
              <Button
                size="sm"
                variant={overdue ? "destructive" : "default"}
                className={cn(
                  "h-9 px-4 gap-1.5",
                  !overdue && "bg-green-600 hover:bg-green-700"
                )}
                onClick={handleComplete}
                disabled={completing}
              >
                <Check className="h-4 w-4" />
                <span className="hidden sm:inline">إنجاز</span>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(task)}>
                  <Edit className="h-4 w-4 ml-2" />
                  تعديل
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(task.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 ml-2" />
                  حذف
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
