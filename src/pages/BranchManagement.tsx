import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Building2, Plus, Pencil, Trash2, Users, Save, Loader2, MapPin, Star } from "lucide-react";
import { toast } from "sonner";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { BranchFormFields, BranchFormValue, emptyBranchForm } from "@/components/branches/BranchFormFields";

interface Branch {
  id: string;
  name: string;
  name_ar: string | null;
  slug: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  user_count?: number;
  client_count?: number;
  policy_count?: number;
}

export default function BranchManagement() {
  const { isAdmin } = useAuth();
  const { agentId } = useAgentContext();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteBranchId, setDeleteBranchId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [form, setForm] = useState<BranchFormValue>(emptyBranchForm);

  const fetchBranches = async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("branches")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at");

      if (error) throw error;

      // Get counts per branch
      const [profilesRes, clientsRes, policiesRes] = await Promise.all([
        supabase.from("profiles").select("branch_id").eq("agent_id", agentId).not("branch_id", "is", null),
        supabase.from("clients").select("branch_id").eq("agent_id", agentId).is("deleted_at", null).not("branch_id", "is", null),
        supabase.from("policies").select("branch_id").eq("agent_id", agentId).is("deleted_at", null).not("branch_id", "is", null),
      ]);

      const count = (items: any[] | null, field: string) => {
        const map: Record<string, number> = {};
        (items || []).forEach((r: any) => { if (r[field]) map[r[field]] = (map[r[field]] || 0) + 1; });
        return map;
      };

      const userMap = count(profilesRes.data, "branch_id");
      const clientMap = count(clientsRes.data, "branch_id");
      const policyMap = count(policiesRes.data, "branch_id");

      setBranches((data || []).map(b => ({
        ...b,
        user_count: userMap[b.id] || 0,
        client_count: clientMap[b.id] || 0,
        policy_count: policyMap[b.id] || 0,
      })));
    } catch (e: any) {
      toast.error("فشل في تحميل الفروع");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (agentId) fetchBranches();
  }, [agentId]);

  const openNew = () => {
    setEditBranch(null);
    setForm(emptyBranchForm);
    setDialogOpen(true);
  };

  const openEdit = (branch: Branch) => {
    setEditBranch(branch);
    setForm({
      name: branch.name,
      name_ar: branch.name_ar || "",
      is_active: branch.is_active,
      is_default: branch.is_default,
    });
    setDialogOpen(true);
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
      const slug = name.toLowerCase().replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "-").replace(/-+/g, "-");

      if (editBranch) {
        const { error } = await supabase
          .from("branches")
          .update({
            name,
            name_ar: form.name_ar.trim() || null,
            slug,
            is_active: form.is_active,
            is_default: form.is_default,
          })
          .eq("id", editBranch.id);
        if (error) throw error;
        toast.success("تم تحديث الفرع");
      } else {
        const { error } = await supabase
          .from("branches")
          .insert({
            name,
            name_ar: form.name_ar.trim() || null,
            slug: `${slug}-${Date.now()}`,
            is_active: form.is_active,
            is_default: form.is_default,
            agent_id: agentId,
          });
        if (error) throw error;
        toast.success("تم إضافة الفرع");
      }

      setDialogOpen(false);
      fetchBranches();
    } catch (e: any) {
      toast.error(e.message || "فشل في حفظ الفرع");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteBranchId) return;
    setDeleting(true);
    try {
      // Check if branch has users
      const branch = branches.find(b => b.id === deleteBranchId);
      if (branch && (branch.user_count || 0) > 0) {
        toast.error(`لا يمكن حذف الفرع — يوجد ${branch.user_count} مستخدم مرتبط به. قم بنقلهم أولاً.`);
        setDeleting(false);
        setDeleteBranchId(null);
        return;
      }

      const { error } = await supabase
        .from("branches")
        .delete()
        .eq("id", deleteBranchId);
      if (error) throw error;
      toast.success("تم حذف الفرع");
      setDeleteBranchId(null);
      fetchBranches();
    } catch (e: any) {
      toast.error(e.message || "فشل في حذف الفرع");
    } finally {
      setDeleting(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <MainLayout>
      <Header
        title="الفروع"
        subtitle="إضافة وتعديل فروع الوكالة"
      />

      <div className="p-4 md:p-6 space-y-6" dir="rtl">
        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" />
            فرع جديد
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : branches.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <MapPin className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
              <h3 className="font-bold text-lg mb-1">لا توجد فروع</h3>
              <p className="text-muted-foreground text-sm mb-4">أضف فروع الوكالة لتنظيم العمل وتوزيع المستخدمين</p>
              <Button onClick={openNew} className="gap-2">
                <Plus className="h-4 w-4" />
                إضافة أول فرع
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {branches.map(branch => (
              <Card key={branch.id} className="shadow-sm">
                <CardContent className="py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold">{branch.name_ar || branch.name}</span>
                        {branch.name_ar && branch.name !== branch.name_ar && (
                          <span className="text-sm text-muted-foreground">({branch.name})</span>
                        )}
                        {branch.is_default && (
                          <Badge className="bg-amber-100 text-amber-800 gap-1 text-xs">
                            <Star className="h-3 w-3 fill-current" />
                            افتراضي
                          </Badge>
                        )}
                        {!branch.is_active && (
                          <Badge variant="secondary" className="text-xs">غير فعال</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{branch.user_count || 0} مستخدم</span>
                        <span>{branch.client_count || 0} عميل</span>
                        <span>{branch.policy_count || 0} وثيقة</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => openEdit(branch)}>
                      <Pencil className="h-3.5 w-3.5 ml-1" />
                      تعديل
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteBranchId(branch.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent dir="rtl" className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editBranch ? "تعديل الفرع" : "إضافة فرع جديد"}</DialogTitle>
            </DialogHeader>
            <BranchFormFields value={form} onChange={setForm} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Save className="h-4 w-4 ml-2" />}
                {editBranch ? "حفظ التعديل" : "إضافة الفرع"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <DeleteConfirmDialog
          open={!!deleteBranchId}
          onOpenChange={(open) => { if (!open) setDeleteBranchId(null); }}
          onConfirm={handleDelete}
          title="حذف الفرع"
          description="هل أنت متأكد من حذف هذا الفرع؟ لا يمكن حذفه إذا كان مرتبطاً بمستخدمين."
          loading={deleting}
        />
      </div>
    </MainLayout>
  );
}
