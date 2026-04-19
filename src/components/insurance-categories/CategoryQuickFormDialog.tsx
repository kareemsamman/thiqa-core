import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Plus, Pencil, Trash2, Save, Loader2, Star, ArrowRight, Car, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAgentContext } from "@/hooks/useAgentContext";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import {
  CategoryFormFields,
  CategoryFormValue,
  emptyCategoryForm,
} from "@/components/insurance-categories/CategoryFormFields";

interface CategoryRow {
  id: string;
  name: string;
  name_ar: string | null;
  name_he: string | null;
  slug: string;
  mode: "FULL" | "LIGHT";
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
}

interface CategoryQuickFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any save/delete so the parent can refetch. Receives the id of a newly-created row (if any). */
  onChanged?: (createdId?: string) => void;
  /** Whether to start directly in the "create new" form instead of the list view. */
  startInCreate?: boolean;
  /** Optional pre-filled defaults for the create form. */
  initialForm?: Partial<CategoryFormValue>;
}

type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; category: CategoryRow };

export function CategoryQuickFormDialog({
  open,
  onOpenChange,
  onChanged,
  startInCreate,
  initialForm,
}: CategoryQuickFormDialogProps) {
  const { agentId } = useAgentContext();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [form, setForm] = useState<CategoryFormValue>(emptyCategoryForm);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("insurance_categories")
      .select("id, name, name_ar, name_he, slug, mode, is_active, is_default, sort_order")
      .order("sort_order", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error("فشل في تحميل الأنواع");
      return;
    }
    setCategories(
      (data || []).map((c) => ({ ...c, mode: c.mode as "FULL" | "LIGHT" })),
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchCategories().then(() => {
      if (startInCreate) {
        setForm({ ...emptyCategoryForm, ...initialForm });
        setMode({ kind: "create" });
      } else {
        setMode({ kind: "list" });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openCreate = () => {
    setForm({ ...emptyCategoryForm, ...initialForm });
    setMode({ kind: "create" });
  };

  const openEdit = (category: CategoryRow) => {
    setForm({
      name: category.name,
      name_ar: category.name_ar || "",
      name_he: category.name_he || "",
      slug: category.slug,
      mode: category.mode,
      is_active: category.is_active,
      is_default: category.is_default,
    });
    setMode({ kind: "edit", category });
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      toast.error("الاسم والمعرف مطلوبان");
      return;
    }
    const slugRegex = /^[A-Z_]+$/;
    if (!slugRegex.test(form.slug)) {
      toast.error("المعرف يجب أن يكون بالإنجليزية الكبيرة فقط مع _ (مثال: NEW_TYPE)");
      return;
    }

    setSaving(true);
    try {
      if (mode.kind === "edit") {
        const { error } = await supabase
          .from("insurance_categories")
          .update({
            name: form.name.trim(),
            name_ar: form.name_ar.trim() || null,
            name_he: form.name_he.trim() || null,
            slug: form.slug.trim(),
            mode: form.mode,
            is_active: form.is_active,
            is_default: form.is_default,
          })
          .eq("id", mode.category.id);
        if (error) throw error;
        toast.success("تم تحديث نوع التأمين");
        await fetchCategories();
        setMode({ kind: "list" });
        onChanged?.();
      } else {
        const maxOrder = Math.max(...categories.map((c) => c.sort_order), 0);
        const { data, error } = await supabase
          .from("insurance_categories")
          .insert({
            name: form.name.trim(),
            name_ar: form.name_ar.trim() || null,
            name_he: form.name_he.trim() || null,
            slug: form.slug.trim(),
            mode: form.mode,
            is_active: form.is_active,
            is_default: form.is_default,
            sort_order: maxOrder + 1,
            agent_id: agentId,
          })
          .select("id")
          .single();
        if (error) throw error;
        toast.success("تم إضافة نوع التأمين");
        await fetchCategories();
        setMode({ kind: "list" });
        onChanged?.(data?.id);
      }
    } catch (e: any) {
      toast.error(e.message || "فشل في حفظ البيانات");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("insurance_categories")
        .delete()
        .eq("id", deleteId);
      if (error) throw error;
      toast.success("تم حذف نوع التأمين");
      setDeleteId(null);
      await fetchCategories();
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message || "فشل في حذف النوع");
    } finally {
      setDeleting(false);
    }
  };

  const persistOrder = async (ordered: CategoryRow[]) => {
    // Assign dense sort_order based on new position.
    setReordering(true);
    // Optimistic local update so the UI doesn't flicker back.
    setCategories(ordered.map((c, i) => ({ ...c, sort_order: i + 1 })));
    try {
      await Promise.all(
        ordered.map((c, i) =>
          supabase
            .from("insurance_categories")
            .update({ sort_order: i + 1 })
            .eq("id", c.id),
        ),
      );
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message || "فشل في تحديث الترتيب");
      await fetchCategories();
    } finally {
      setReordering(false);
    }
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const next = [...categories];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    setDragIndex(null);
    setDragOverIndex(null);
    persistOrder(next);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const showList = mode.kind === "list";
  const showForm = mode.kind === "create" || mode.kind === "edit";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {showList && "إدارة أنواع التأمين"}
              {mode.kind === "create" && "نوع تأمين جديد"}
              {mode.kind === "edit" && `تعديل: ${mode.category.name_ar || mode.category.name}`}
            </DialogTitle>
          </DialogHeader>

          {showList && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button onClick={openCreate} size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  نوع جديد
                </Button>
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              ) : categories.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
                  لا توجد أنواع تأمين بعد — اضغط "نوع جديد" للبدء
                </div>
              ) : (
                <div className="space-y-2">
                  {reordering && (
                    <p className="text-xs text-muted-foreground text-center">جاري حفظ الترتيب...</p>
                  )}
                  {categories.map((category, index) => (
                    <div
                      key={category.id}
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, index)}
                      onDragEnd={handleDragEnd}
                      className={cn(
                        "flex items-center justify-between gap-3 p-3 rounded-lg border bg-card transition-all",
                        !category.is_active && "opacity-60",
                        dragIndex === index && "opacity-40",
                        dragOverIndex === index && "border-primary border-2 bg-primary/5",
                      )}
                    >
                      <button
                        type="button"
                        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
                        title="اسحب لإعادة الترتيب"
                        aria-label="drag handle"
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                      <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                        {category.mode === "FULL" ? (
                          <Car className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-medium truncate">
                          {category.name_ar || category.name}
                        </span>
                        <Badge
                          variant={category.mode === "FULL" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {category.mode}
                        </Badge>
                        {category.is_default && (
                          <Badge className="bg-amber-100 text-amber-800 gap-1 text-xs">
                            <Star className="h-3 w-3 fill-current" />
                            افتراضي
                          </Badge>
                        )}
                        {!category.is_active && (
                          <Badge variant="secondary" className="text-xs">
                            غير فعال
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(category)}
                          title="تعديل"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(category.id)}
                          title="حذف"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {showForm && (
            <>
              <CategoryFormFields
                value={form}
                onChange={setForm}
                slugLocked={mode.kind === "edit"}
              />
              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" onClick={() => setMode({ kind: "list" })}>
                  <ArrowRight className="h-4 w-4 ml-1" />
                  رجوع
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 ml-2" />
                  )}
                  {mode.kind === "edit" ? "حفظ التعديل" : "إضافة النوع"}
                </Button>
              </DialogFooter>
            </>
          )}

          {showList && (
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                إغلاق
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => {
          if (!o) setDeleteId(null);
        }}
        onConfirm={handleDelete}
        title="حذف نوع التأمين"
        description="هل أنت متأكد من حذف هذا النوع؟ لا يمكن حذفه إذا كان مرتبطاً بمعاملات."
        loading={deleting}
      />
    </>
  );
}
