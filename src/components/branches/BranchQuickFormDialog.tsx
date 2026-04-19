import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Plus, Pencil, Trash2, Save, Loader2, Star, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAgentContext } from "@/hooks/useAgentContext";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import {
  BranchFormFields,
  BranchFormValue,
  emptyBranchForm,
} from "@/components/branches/BranchFormFields";

interface BranchRow {
  id: string;
  name: string;
  name_ar: string | null;
  is_active: boolean;
  is_default: boolean;
}

interface BranchQuickFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any save/delete so the parent can refetch its branch list. Receives the id of a newly-created row (if any). */
  onChanged?: (createdId?: string) => void;
  /** Whether to start directly in the "create new" form instead of the list view. */
  startInCreate?: boolean;
  /** Optional pre-filled defaults for the create form (e.g. is_default=true when there are no branches yet). */
  initialForm?: Partial<BranchFormValue>;
}

type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; branch: BranchRow };

export function BranchQuickFormDialog({
  open,
  onOpenChange,
  onChanged,
  startInCreate,
  initialForm,
}: BranchQuickFormDialogProps) {
  const { agentId } = useAgentContext();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [form, setForm] = useState<BranchFormValue>(emptyBranchForm);

  const fetchBranches = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("branches")
      .select("id, name, name_ar, is_active, is_default")
      .eq("agent_id", agentId)
      .order("created_at");
    setLoading(false);
    if (error) {
      toast.error("فشل في تحميل الفروع");
      return;
    }
    setBranches(data || []);
  }, [agentId]);

  // Fetch when opened, and pick the initial mode.
  useEffect(() => {
    if (!open) return;
    fetchBranches().then(() => {
      if (startInCreate) {
        setForm({ ...emptyBranchForm, ...initialForm });
        setMode({ kind: "create" });
      } else {
        setMode({ kind: "list" });
      }
    });
    // We intentionally depend only on `open` — other deps would re-run mid-flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openCreate = () => {
    setForm({ ...emptyBranchForm, ...initialForm });
    setMode({ kind: "create" });
  };

  const openEdit = (branch: BranchRow) => {
    setForm({
      name: branch.name,
      name_ar: branch.name_ar || "",
      is_active: branch.is_active,
      is_default: branch.is_default,
    });
    setMode({ kind: "edit", branch });
  };

  const handleSave = async () => {
    if (!form.name.trim() && !form.name_ar.trim()) {
      toast.error("يرجى إدخال اسم الفرع");
      return;
    }
    if (!agentId) return;

    setSaving(true);
    try {
      const name = form.name.trim() || form.name_ar.trim();
      const slug = name
        .toLowerCase()
        .replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "-")
        .replace(/-+/g, "-");

      if (mode.kind === "edit") {
        const { error } = await supabase
          .from("branches")
          .update({
            name,
            name_ar: form.name_ar.trim() || null,
            slug,
            is_active: form.is_active,
            is_default: form.is_default,
          })
          .eq("id", mode.branch.id);
        if (error) throw error;
        toast.success("تم تحديث الفرع");
        await fetchBranches();
        setMode({ kind: "list" });
        onChanged?.();
      } else {
        const { data, error } = await supabase
          .from("branches")
          .insert({
            name,
            name_ar: form.name_ar.trim() || null,
            slug: `${slug}-${Date.now()}`,
            is_active: form.is_active,
            is_default: form.is_default,
            agent_id: agentId,
          })
          .select("id")
          .single();
        if (error) throw error;
        toast.success("تم إضافة الفرع");
        await fetchBranches();
        setMode({ kind: "list" });
        onChanged?.(data?.id);
      }
    } catch (e: any) {
      toast.error(e.message || "فشل في حفظ الفرع");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("branches").delete().eq("id", deleteId);
      if (error) throw error;
      toast.success("تم حذف الفرع");
      setDeleteId(null);
      await fetchBranches();
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message || "فشل في حذف الفرع");
    } finally {
      setDeleting(false);
    }
  };

  const showList = mode.kind === "list";
  const showForm = mode.kind === "create" || mode.kind === "edit";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              {showList && "إدارة الفروع"}
              {mode.kind === "create" && "إضافة فرع جديد"}
              {mode.kind === "edit" && `تعديل: ${mode.branch.name_ar || mode.branch.name}`}
            </DialogTitle>
          </DialogHeader>

          {showList && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button onClick={openCreate} size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  فرع جديد
                </Button>
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              ) : branches.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
                  لا توجد فروع بعد — اضغط "فرع جديد" للبدء
                </div>
              ) : (
                <div className="space-y-2">
                  {branches.map((branch) => (
                    <div
                      key={branch.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-card"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">
                          {branch.name_ar || branch.name}
                        </span>
                        {branch.is_default && (
                          <Badge className="bg-amber-100 text-amber-800 gap-1 text-xs">
                            <Star className="h-3 w-3 fill-current" />
                            افتراضي
                          </Badge>
                        )}
                        {!branch.is_active && (
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
                          onClick={() => openEdit(branch)}
                          title="تعديل"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(branch.id)}
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
              <BranchFormFields value={form} onChange={setForm} />
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
                  {mode.kind === "edit" ? "حفظ التعديل" : "إضافة الفرع"}
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
        title="حذف الفرع"
        description="هل أنت متأكد من حذف هذا الفرع؟ لا يمكن حذفه إذا كان مرتبطاً بمستخدمين أو معاملات."
        loading={deleting}
      />
    </>
  );
}
