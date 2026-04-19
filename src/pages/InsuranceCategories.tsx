import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { Plus, Edit, Trash2, Car, FileText, Loader2, Star, ChevronUp, ChevronDown } from "lucide-react";
import {
  CategoryFormFields,
  CategoryFormValue,
  emptyCategoryForm,
} from "@/components/insurance-categories/CategoryFormFields";

interface InsuranceCategory {
  id: string;
  name: string;
  name_ar: string | null;
  name_he: string | null;
  slug: string;
  mode: 'FULL' | 'LIGHT';
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  policy_count?: number;
}

export default function InsuranceCategories() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { agentId } = useAgentContext();
  const [categories, setCategories] = useState<InsuranceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingCategory, setEditingCategory] = useState<InsuranceCategory | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const [formData, setFormData] = useState<CategoryFormValue>(emptyCategoryForm);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    setLoading(true);
    
    // Fetch categories
    const { data: categoriesData, error: categoriesError } = await supabase
      .from('insurance_categories')
      .select('*')
      .order('sort_order', { ascending: true });

    if (categoriesError) {
      toast({ title: "خطأ", description: "فشل في تحميل الأنواع", variant: "destructive" });
      setLoading(false);
      return;
    }

    // Fetch policy counts per category (using slug as policy_type_parent)
    const { data: policyCounts } = await supabase
      .from('policies')
      .select('policy_type_parent')
      .is('deleted_at', null);

    const countMap: Record<string, number> = {};
    policyCounts?.forEach(p => {
      const key = p.policy_type_parent;
      countMap[key] = (countMap[key] || 0) + 1;
    });

    const categoriesWithCounts = (categoriesData || []).map(cat => ({
      ...cat,
      mode: cat.mode as 'FULL' | 'LIGHT',
      policy_count: countMap[cat.slug] || 0,
    }));

    setCategories(categoriesWithCounts);
    setLoading(false);
  };

  const handleEdit = (category: InsuranceCategory) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      name_ar: category.name_ar || '',
      name_he: category.name_he || '',
      slug: category.slug,
      mode: category.mode,
      is_active: category.is_active,
      is_default: category.is_default,
    });
    setShowEditor(true);
  };

  const handleCreate = () => {
    setEditingCategory(null);
    setFormData(emptyCategoryForm);
    setShowEditor(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.slug.trim()) {
      toast({ title: "خطأ", description: "الاسم والمعرف مطلوبان", variant: "destructive" });
      return;
    }

    // Validate slug format (uppercase, underscores)
    const slugRegex = /^[A-Z_]+$/;
    if (!slugRegex.test(formData.slug)) {
      toast({ title: "خطأ", description: "المعرف يجب أن يكون بالإنجليزية الكبيرة فقط مع _ (مثال: NEW_TYPE)", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      if (editingCategory) {
        const { error } = await supabase
          .from('insurance_categories')
          .update({
            name: formData.name.trim(),
            name_ar: formData.name_ar.trim() || null,
            name_he: formData.name_he.trim() || null,
            slug: formData.slug.trim(),
            mode: formData.mode,
            is_active: formData.is_active,
            is_default: formData.is_default,
          })
          .eq('id', editingCategory.id);

        if (error) throw error;
        toast({ title: "تم الحفظ", description: "تم تحديث نوع التأمين" });
      } else {
        // Get max sort_order
        const maxOrder = Math.max(...categories.map(c => c.sort_order), 0);
        
        const { error } = await supabase
          .from('insurance_categories')
          .insert({
            name: formData.name.trim(),
            name_ar: formData.name_ar.trim() || null,
            name_he: formData.name_he.trim() || null,
            slug: formData.slug.trim(),
            mode: formData.mode,
            is_active: formData.is_active,
            is_default: formData.is_default,
            sort_order: maxOrder + 1,
            agent_id: agentId,
          });

        if (error) throw error;
        toast({ title: "تم الحفظ", description: "تم إضافة نوع التأمين" });
      }

      setShowEditor(false);
      fetchCategories();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message || "فشل في حفظ البيانات", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (category: InsuranceCategory) => {
    if (category.policy_count && category.policy_count > 0) {
      toast({ title: "لا يمكن الحذف", description: `يوجد ${category.policy_count} معاملة مرتبطة بهذا النوع`, variant: "destructive" });
      return;
    }

    if (!confirm('هل أنت متأكد من حذف هذا النوع؟')) return;

    const { error } = await supabase
      .from('insurance_categories')
      .delete()
      .eq('id', category.id);

    if (error) {
      toast({ title: "خطأ", description: "فشل في حذف النوع", variant: "destructive" });
      return;
    }

    toast({ title: "تم الحذف", description: "تم حذف نوع التأمين" });
    fetchCategories();
  };

  const handleToggleActive = async (category: InsuranceCategory) => {
    const { error } = await supabase
      .from('insurance_categories')
      .update({ is_active: !category.is_active })
      .eq('id', category.id);

    if (error) {
      toast({ title: "خطأ", description: "فشل في تحديث الحالة", variant: "destructive" });
      return;
    }

    fetchCategories();
  };

  const handleSetDefault = async (category: InsuranceCategory) => {
    const { error } = await supabase
      .from('insurance_categories')
      .update({ is_default: true })
      .eq('id', category.id);

    if (error) {
      toast({ title: "خطأ", description: "فشل في تعيين كافتراضي", variant: "destructive" });
      return;
    }

    toast({ title: "تم التعيين", description: `${category.name_ar || category.name} هو النوع الافتراضي الآن` });
    fetchCategories();
  };

  const handleMoveUp = async (category: InsuranceCategory, index: number) => {
    if (index === 0) return;
    const prev = categories[index - 1];
    
    await Promise.all([
      supabase.from('insurance_categories').update({ sort_order: prev.sort_order }).eq('id', category.id),
      supabase.from('insurance_categories').update({ sort_order: category.sort_order }).eq('id', prev.id),
    ]);
    
    fetchCategories();
  };

  const handleMoveDown = async (category: InsuranceCategory, index: number) => {
    if (index === categories.length - 1) return;
    const next = categories[index + 1];
    
    await Promise.all([
      supabase.from('insurance_categories').update({ sort_order: next.sort_order }).eq('id', category.id),
      supabase.from('insurance_categories').update({ sort_order: category.sort_order }).eq('id', next.id),
    ]);
    
    fetchCategories();
  };

  if (!isAdmin) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">فقط المديرين يمكنهم الوصول لهذه الصفحة</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">إدارة أنواع التأمين</h1>
            <p className="text-muted-foreground">إضافة وتعديل أنواع التأمين المتاحة في النظام</p>
          </div>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 ml-2" />
            نوع جديد
          </Button>
        </div>

        {/* Info Card */}
        <Card className="p-4 bg-muted/50 border-dashed">
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="bg-primary">FULL</Badge>
              <span>تأمين كامل مع سيارة وشركات وأسعار</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">LIGHT</Badge>
              <span>تأمين بسيط بدون تفاصيل</span>
            </div>
          </div>
        </Card>

        {/* Categories Table */}
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right w-12">ترتيب</TableHead>
                  <TableHead className="text-right">الاسم</TableHead>
                  <TableHead className="text-right">المعرف</TableHead>
                  <TableHead className="text-right">النوع</TableHead>
                  <TableHead className="text-right">المعاملات</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">افتراضي</TableHead>
                  <TableHead className="text-right">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : categories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      لا توجد أنواع تأمين. أضف النوع الأول.
                    </TableCell>
                  </TableRow>
                ) : (
                  categories.map((category, index) => (
                    <TableRow key={category.id} className={!category.is_active ? 'opacity-50' : ''}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6"
                            onClick={() => handleMoveUp(category, index)}
                            disabled={index === 0}
                          >
                            <ChevronUp className="h-3 w-3" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6"
                            onClick={() => handleMoveDown(category, index)}
                            disabled={index === categories.length - 1}
                          >
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{category.name_ar || category.name}</span>
                          {category.name_he && (
                            <span className="text-xs text-muted-foreground ltr-nums">{category.name_he}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-2 py-1 rounded">{category.slug}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant={category.mode === 'FULL' ? 'default' : 'secondary'} className="gap-1">
                          {category.mode === 'FULL' ? <Car className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                          {category.mode}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{category.policy_count || 0}</Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={category.is_active}
                          onCheckedChange={() => handleToggleActive(category)}
                        />
                      </TableCell>
                      <TableCell>
                        {category.is_default ? (
                          <Badge className="bg-amber-100 text-amber-800 gap-1">
                            <Star className="h-3 w-3 fill-current" />
                            افتراضي
                          </Badge>
                        ) : (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleSetDefault(category)}
                            className="text-xs"
                          >
                            تعيين
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(category)} title="تعديل">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => handleDelete(category)} 
                            title="حذف"
                            disabled={category.policy_count! > 0}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      {/* Editor Dialog */}
      <Dialog open={showEditor} onOpenChange={setShowEditor}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? `تعديل: ${editingCategory.name_ar || editingCategory.name}` : 'نوع تأمين جديد'}
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <CategoryFormFields
              value={formData}
              onChange={setFormData}
              slugLocked={!!editingCategory}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditor(false)}>
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
