import { useState } from "react";
import { format, addDays, subDays } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import {
  Plus,
  ChevronRight,
  ChevronLeft,
  Calendar as CalendarIcon,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ListTodo,
  Users,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { useTasks, Task } from "@/hooks/useTasks";
import { useAuth } from "@/hooks/useAuth";
import { TaskDrawer } from "@/components/tasks/TaskDrawer";
import { TaskCard } from "@/components/tasks/TaskCard";
import { cn } from "@/lib/utils";

type FilterTab = 'my-tasks' | 'created-by-me' | 'all';

export default function Tasks() {
  const { user, isAdmin } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [filterTab, setFilterTab] = useState<FilterTab>('my-tasks');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const {
    tasks,
    isLoading,
    stats,
    createTask,
    completeTask,
    deleteTask,
    isCreating,
  } = useTasks(selectedDate);

  // Calculate stats for badges and banner
  const myTasks = tasks.filter(t => t.assigned_to === user?.id);
  const myPendingCount = myTasks.filter(t => t.status === 'pending').length;
  const myCompletedCount = myTasks.filter(t => t.status === 'completed').length;
  const myTotalCount = myPendingCount + myCompletedCount;
  const completionPercentage = myTotalCount > 0 
    ? Math.round((myCompletedCount / myTotalCount) * 100) 
    : 0;
  const createdForOthersCount = tasks.filter(t => 
    t.created_by === user?.id && t.assigned_to !== user?.id
  ).length;

  // Filter tasks based on selected tab
  const filteredTasks = tasks.filter(task => {
    switch (filterTab) {
      case 'my-tasks':
        return task.assigned_to === user?.id;
      case 'created-by-me':
        // Only tasks created for others (not for myself)
        return task.created_by === user?.id && task.assigned_to !== user?.id;
      case 'all':
        return true;
      default:
        return true;
    }
  });

  const pendingTasks = filteredTasks.filter(t => t.status === 'pending');
  const completedTasks = filteredTasks.filter(t => t.status === 'completed');

  const goToYesterday = () => setSelectedDate(subDays(selectedDate, 1));
  const goToTomorrow = () => setSelectedDate(addDays(selectedDate, 1));
  const goToToday = () => setSelectedDate(new Date());

  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setEditingTask(null);
  };

  return (
    <MainLayout>
      <Header
        title="المهام"
        subtitle="إدارة وتتبع المهام اليومية"
      />

      <div className="p-6 space-y-6">
        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setDrawerOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            مهمة جديدة
          </Button>
        </div>

        {/* Stats Summary Banner */}
        <Card className="bg-gradient-to-l from-violet-50 to-background border-violet-200/50">
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* مهامي المعلقة */}
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                  <Clock className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold ltr-nums">{myPendingCount}</p>
                  <p className="text-sm text-muted-foreground">مهامي المعلقة</p>
                </div>
              </div>

              {/* مهامي المنجزة */}
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 text-green-600">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold ltr-nums">{myCompletedCount}</p>
                  <p className="text-sm text-muted-foreground">أنجزتها اليوم</p>
                </div>
              </div>

              {/* Progress */}
              <div className="flex-1 min-w-[150px] max-w-[200px]">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">إنجازي</span>
                  <span className="font-medium ltr-nums">{completionPercentage}%</span>
                </div>
                <Progress value={completionPercentage} className="h-2" />
              </div>

              {/* المهام للآخرين */}
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                  <Users className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold ltr-nums">{createdForOthersCount}</p>
                  <p className="text-sm text-muted-foreground">أنشأتها للآخرين</p>
                </div>
              </div>

              {/* متأخرة */}
              {stats.overdue > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 text-red-600">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold ltr-nums">{stats.overdue}</p>
                    <p className="text-sm text-muted-foreground">متأخرة</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Filter Tabs with Badges */}
        <Tabs value={filterTab} onValueChange={(v) => setFilterTab(v as FilterTab)}>
          <TabsList>
            <TabsTrigger value="my-tasks" className="gap-2">
              مهامي
              {myPendingCount > 0 && (
                <Badge variant="secondary" className="h-5 min-w-[20px] px-1.5 text-xs">
                  {myPendingCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="created-by-me" className="gap-2">
              أنشأتها للآخرين
              {createdForOthersCount > 0 && (
                <Badge variant="outline" className="h-5 min-w-[20px] px-1.5 text-xs">
                  {createdForOthersCount}
                </Badge>
              )}
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="all" className="gap-2">
                الكل
                <Badge variant="outline" className="h-5 min-w-[20px] px-1.5 text-xs">
                  {tasks.length}
                </Badge>
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>

        {/* Date Navigation */}
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={goToYesterday}>
                <ChevronRight className="h-4 w-4 ml-1" />
                أمس
              </Button>

              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={isToday ? "default" : "outline"}
                      className="min-w-[200px]"
                    >
                      <CalendarIcon className="h-4 w-4 ml-2" />
                      {format(selectedDate, "EEEE, d MMMM yyyy", { locale: ar })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="center">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => date && setSelectedDate(date)}
                      locale={ar}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                {!isToday && (
                  <Button variant="outline" size="sm" onClick={goToToday}>
                    اليوم
                  </Button>
                )}
              </div>

              <Button variant="ghost" size="sm" onClick={goToTomorrow}>
                غداً
                <ChevronLeft className="h-4 w-4 mr-1" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tasks List */}
        <div className="space-y-3">
          {isLoading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          ) : filteredTasks.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ListTodo className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">
                  لا توجد مهام لهذا اليوم
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setDrawerOpen(true)}
                >
                  <Plus className="h-4 w-4 ml-2" />
                  أضف مهمة
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Pending tasks first */}
              {pendingTasks.length > 0 && (
                <div className="space-y-2">
                  {pendingTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onComplete={completeTask}
                      onEdit={handleEdit}
                      onDelete={deleteTask}
                    />
                  ))}
                </div>
              )}

              {/* Completed tasks */}
              {completedTasks.length > 0 && (
                <div className="space-y-2 mt-6">
                  <p className="text-sm text-muted-foreground font-medium px-1">
                    المهام المنجزة ({completedTasks.length})
                  </p>
                  {completedTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onComplete={completeTask}
                      onEdit={handleEdit}
                      onDelete={deleteTask}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Task Drawer */}
      <TaskDrawer
        open={drawerOpen}
        onOpenChange={handleCloseDrawer}
        task={editingTask}
        onSubmit={createTask}
        isSubmitting={isCreating}
        defaultDate={selectedDate}
      />
    </MainLayout>
  );
}
