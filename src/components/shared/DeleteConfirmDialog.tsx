import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  loading?: boolean;
  /** When provided alongside loading=true, a 0-100 progress bar is
   *  shown instead of a static "جاري الحذف..." label. Useful for
   *  multi-stage deletes (e.g. removing a Bunny Stream video then
   *  the DB row) where the user benefits from visual feedback. */
  progress?: number;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title = "تأكيد الحذف",
  description = "هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع عن هذا الإجراء.",
  loading = false,
  progress,
}: DeleteConfirmDialogProps) {
  const showProgress = loading && typeof progress === "number";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {showProgress && (
          <div className="space-y-1.5 py-2">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              جاري الحذف... {Math.round(progress!)}%
            </p>
          </div>
        )}

        <AlertDialogFooter className="flex-row-reverse gap-2">
          <AlertDialogCancel disabled={loading}>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? (showProgress ? `${Math.round(progress!)}%` : "جاري الحذف...") : "حذف"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}