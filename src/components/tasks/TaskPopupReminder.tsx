import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, Clock, X, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDueTasksChecker } from "@/hooks/useTasks";

export function TaskPopupReminder() {
  const navigate = useNavigate();
  const { dueTask, dismissTask, completeAndDismiss } = useDueTasksChecker();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Play notification sound when task appears
  useEffect(() => {
    if (dueTask) {
      // Try to play notification sound
      try {
        // Create a simple beep using Web Audio API
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        gainNode.gain.value = 0.3;
        
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.2);
        
        // Second beep
        setTimeout(() => {
          const osc2 = audioContext.createOscillator();
          const gain2 = audioContext.createGain();
          osc2.connect(gain2);
          gain2.connect(audioContext.destination);
          osc2.frequency.value = 1000;
          osc2.type = 'sine';
          gain2.gain.value = 0.3;
          osc2.start();
          osc2.stop(audioContext.currentTime + 0.2);
        }, 250);
      } catch (e) {
        // Audio not supported or blocked
        console.log('Audio notification not available');
      }
    }
  }, [dueTask?.id]);

  const handleOpenTasks = () => {
    dismissTask();
    navigate('/tasks');
  };

  const creatorName = dueTask?.creator?.full_name || dueTask?.creator?.email?.split('@')[0] || 'غير معروف';

  return (
    <Dialog open={!!dueTask} onOpenChange={(open) => !open && dismissTask()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 animate-pulse">
              <Bell className="h-6 w-6 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg">🔔 حان موعد المهمة!</DialogTitle>
              <DialogDescription className="flex items-center gap-1 mt-1">
                <Clock className="h-3 w-3" />
                {dueTask?.due_time.slice(0, 5)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4">
          <h3 className="text-xl font-semibold mb-2">{dueTask?.title}</h3>
          {dueTask?.description && (
            <p className="text-muted-foreground mb-4">{dueTask.description}</p>
          )}
          <p className="text-sm text-muted-foreground">
            من: <span className="font-medium text-foreground">{creatorName}</span>
          </p>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            onClick={completeAndDismiss}
            className="flex-1 bg-green-600 hover:bg-green-700"
          >
            <Check className="h-4 w-4 ml-2" />
            إنجاز الآن
          </Button>
          <Button
            variant="outline"
            onClick={dismissTask}
            className="flex-1"
          >
            <Clock className="h-4 w-4 ml-2" />
            تذكيري لاحقاً
          </Button>
          <Button
            variant="ghost"
            onClick={handleOpenTasks}
            className="flex-1"
          >
            <ExternalLink className="h-4 w-4 ml-2" />
            فتح المهام
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
