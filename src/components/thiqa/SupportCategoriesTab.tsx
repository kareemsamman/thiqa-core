import { useEffect, useState } from "react";
import { Plus, Trash2, Save, Loader2, ChevronDown, ChevronLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const supabase = supabaseTyped as any;

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name_ar: string;
  name_en: string | null;
  sort_order: number;
  is_active: boolean;
}

/**
 * Categories CRUD for support tickets — embedded as a tab inside
 * ThiqaSettings. Tree view with two levels (top-level + children),
 * inline rename/sort/toggle, and add buttons for both top-level and
 * per-parent subcategory creation. RLS gates writes to super-admin
 * so a non-admin who somehow lands here gets a polite failure
 * instead of broken UI.
 */
export function SupportCategoriesTab() {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("support_categories")
      .select("*")
      .order("sort_order");
    setRows((data as CategoryRow[]) || []);
    setLoading(false);
  };

  const tops = rows.filter((r) => r.parent_id === null);
  const childrenOf = (id: string) => rows.filter((r) => r.parent_id === id);

  const updateRow = async (id: string, patch: Partial<CategoryRow>) => {
    setSavingId(id);
    const { error } = await supabase
      .from("support_categories")
      .update(patch)
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast.error("تعذّر الحفظ");
      return;
    }
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  };

  const addTop = async () => {
    const name = prompt("اسم الفئة (عربي):");
    if (!name?.trim()) return;
    const { data, error } = await supabase
      .from("support_categories")
      .insert({ name_ar: name.trim(), sort_order: tops.length * 10 + 10 })
      .select("*")
      .single();
    if (error || !data) { toast.error("تعذّر الإضافة"); return; }
    setRows((prev) => [...prev, data as CategoryRow]);
  };

  const addChild = async (parentId: string) => {
    const name = prompt("اسم الفئة الفرعية (عربي):");
    if (!name?.trim()) return;
    const siblings = childrenOf(parentId);
    const { data, error } = await supabase
      .from("support_categories")
      .insert({
        name_ar: name.trim(),
        parent_id: parentId,
        sort_order: siblings.length * 10 + 10,
      })
      .select("*")
      .single();
    if (error || !data) { toast.error("تعذّر الإضافة"); return; }
    setRows((prev) => [...prev, data as CategoryRow]);
    setExpanded((e) => ({ ...e, [parentId]: true }));
  };

  const remove = async (id: string) => {
    if (!confirm("حذف هذه الفئة؟ سيُحذف معها كل الفئات الفرعية. التذاكر القائمة لن تُحذف لكن ستفقد ربطها بالفئة.")) return;
    const { error } = await supabase
      .from("support_categories")
      .delete()
      .eq("id", id);
    if (error) { toast.error("تعذّر الحذف"); return; }
    setRows((prev) => prev.filter((r) => r.id !== id && r.parent_id !== id));
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>فئات تذاكر الدعم</CardTitle>
            <CardDescription>
              يختار الوكلاء من هذه الفئات عند فتح تذكرة. أعمدة فرعية موجودة لكل فئة رئيسية لتفصيل المشكلة (مثلاً Bug → العملاء).
            </CardDescription>
          </div>
          <Button onClick={addTop} className="gap-2">
            <Plus className="h-4 w-4" />
            فئة رئيسية جديدة
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {tops.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground border border-dashed rounded-xl">
            لا توجد فئات بعد. أضف فئة رئيسية أولى.
          </div>
        )}
        {tops.map((top) => {
          const kids = childrenOf(top.id);
          const isOpen = expanded[top.id] ?? true;
          return (
            <div key={top.id} className="border rounded-xl overflow-hidden">
              <CategoryRowEditor
                row={top}
                saving={savingId === top.id}
                onChange={(patch) => updateRow(top.id, patch)}
                onDelete={() => remove(top.id)}
                trailing={
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [top.id]: !isOpen }))}
                    className="p-1 hover:bg-muted rounded"
                    aria-label="توسيع"
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                  </button>
                }
              />
              {isOpen && (
                <div className="border-t bg-muted/20 p-3 space-y-2">
                  {kids.map((c) => (
                    <CategoryRowEditor
                      key={c.id}
                      row={c}
                      saving={savingId === c.id}
                      indent
                      onChange={(patch) => updateRow(c.id, patch)}
                      onDelete={() => remove(c.id)}
                    />
                  ))}
                  <Button variant="outline" size="sm" onClick={() => addChild(top.id)} className="gap-2">
                    <Plus className="h-3.5 w-3.5" />
                    فئة فرعية
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CategoryRowEditor({
  row,
  saving,
  indent,
  onChange,
  onDelete,
  trailing,
}: {
  row: CategoryRow;
  saving: boolean;
  indent?: boolean;
  onChange: (patch: Partial<CategoryRow>) => void;
  onDelete: () => void;
  trailing?: React.ReactNode;
}) {
  const [name, setName] = useState(row.name_ar);
  const [sort, setSort] = useState(String(row.sort_order));

  useEffect(() => { setName(row.name_ar); setSort(String(row.sort_order)); }, [row.id, row.name_ar, row.sort_order]);

  const dirty = name !== row.name_ar || sort !== String(row.sort_order);

  return (
    <div className={cn("flex items-center gap-2 p-3 bg-background rounded-lg", indent && "rounded-md")}>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="اسم الفئة"
        className="flex-1 h-9"
      />
      <Input
        type="number"
        value={sort}
        onChange={(e) => setSort(e.target.value)}
        title="ترتيب العرض"
        className="w-20 h-9 text-center ltr-nums"
      />
      <div className="flex items-center gap-1.5" title={row.is_active ? "مفعّل" : "متوقف"}>
        <Switch
          checked={row.is_active}
          onCheckedChange={(v) => onChange({ is_active: v })}
        />
      </div>
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange({ name_ar: name.trim(), sort_order: parseInt(sort, 10) || 0 })}
          disabled={saving}
          className="gap-1"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          حفظ
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive hover:bg-destructive/10">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      {trailing}
    </div>
  );
}
