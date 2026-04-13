import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Wrench, Building2, FileText, Calendar, Car, 
  Plus, CheckCircle, MessageSquare, Trash2, Bell
} from "lucide-react";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { format } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

type ClaimStatus = "open" | "in_progress" | "completed";

const STATUS_CONFIG: Record<ClaimStatus, { label: string; color: string }> = {
  open: { label: "مفتوح", color: "bg-primary/10 text-primary" },
  in_progress: { label: "قيد التنفيذ", color: "bg-accent text-accent-foreground" },
  completed: { label: "مكتمل", color: "bg-muted text-muted-foreground" },
};

const REMINDER_TYPES = [
  { value: "garage", label: "الكراج" },
  { value: "insured", label: "المؤمن" },
  { value: "other", label: "أخرى" },
];

export default function RepairClaimDetail() {
  const { claimId } = useParams<{ claimId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  const [newNote, setNewNote] = useState("");
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [repairsDescription, setRepairsDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [reminderDate, setReminderDate] = useState("");
  const [reminderType, setReminderType] = useState("garage");
  const [reminderMessage, setReminderMessage] = useState("");

  // Fetch claim details
  const { data: claim, isLoading: claimLoading } = useQuery({
    queryKey: ["repair-claim", claimId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("repair_claims")
        .select(`
          *,
          insurance_company:insurance_companies(name, name_ar),
          client:clients(full_name, phone_number),
          policy:policies(policy_type_parent, policy_type_child, policy_number)
        `)
        .eq("id", claimId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!claimId,
  });

  // Fetch notes
  const { data: notes } = useQuery({
    queryKey: ["repair-claim-notes", claimId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("repair_claim_notes")
        .select("*")
        .eq("claim_id", claimId)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!claimId,
  });

  // Fetch reminders
  const { data: reminders } = useQuery({
    queryKey: ["repair-claim-reminders", claimId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("repair_claim_reminders")
        .select("*")
        .eq("claim_id", claimId)
        .order("reminder_date", { ascending: true });
      
      if (error) throw error;
      return data;
    },
    enabled: !!claimId,
  });

  // Add note mutation
  const addNoteMutation = useMutation({
    mutationFn: async (note: string) => {
      const { error } = await supabase
        .from("repair_claim_notes")
        .insert({
          claim_id: claimId,
          note,
          created_by: user?.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repair-claim-notes", claimId] });
      setNewNote("");
      toast.success("تمت إضافة الملاحظة");
    },
    onError: () => {
      toast.error("حدث خطأ أثناء إضافة الملاحظة");
    },
  });

  // Add reminder mutation
  const addReminderMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("repair_claim_reminders")
        .insert({
          claim_id: claimId,
          reminder_date: reminderDate,
          reminder_type: reminderType,
          message: reminderMessage || null,
          created_by: user?.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repair-claim-reminders", claimId] });
      setReminderDialogOpen(false);
      setReminderDate("");
      setReminderType("garage");
      setReminderMessage("");
      toast.success("تمت إضافة التذكير");
    },
    onError: () => {
      toast.error("حدث خطأ أثناء إضافة التذكير");
    },
  });

  // Toggle reminder done mutation
  const toggleReminderMutation = useMutation({
    mutationFn: async ({ id, is_done }: { id: string; is_done: boolean }) => {
      const { error } = await supabase
        .from("repair_claim_reminders")
        .update({ is_done })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repair-claim-reminders", claimId] });
    },
  });

  // Delete reminder mutation
  const deleteReminderMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("repair_claim_reminders")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repair-claim-reminders", claimId] });
      toast.success("تم حذف التذكير");
    },
  });

  // Close claim mutation
  const closeClaimMutation = useMutation({
    mutationFn: async () => {
      // Create expense first
      const { data: expense, error: expenseError } = await supabase
        .from("expenses")
        .insert({
          description: `مطالبة ${claim?.claim_number}: ${repairsDescription}`,
          amount: parseFloat(totalAmount),
          expense_date: new Date().toISOString().split('T')[0],
          category: "repair_claims",
          notes: `كراج: ${claim?.garage_name}`,
        })
        .select()
        .single();

      if (expenseError) throw expenseError;

      // Update claim
      const { error: claimError } = await supabase
        .from("repair_claims")
        .update({
          status: "completed",
          repairs_description: repairsDescription,
          total_amount: parseFloat(totalAmount),
          expense_id: expense.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", claimId);

      if (claimError) throw claimError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repair-claim", claimId] });
      setCloseDialogOpen(false);
      toast.success("تم إغلاق الملف وإضافته للمصاريف");
    },
    onError: () => {
      toast.error("حدث خطأ أثناء إغلاق الملف");
    },
  });

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async (status: ClaimStatus) => {
      const { error } = await supabase
        .from("repair_claims")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", claimId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repair-claim", claimId] });
      toast.success("تم تحديث الحالة");
    },
  });

  if (claimLoading) {
    return (
      <MainLayout>
        <div className="p-6 space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }

  if (!claim) {
    return (
      <MainLayout>
        <div className="p-6 text-center text-muted-foreground">
          المطالبة غير موجودة
        </div>
      </MainLayout>
    );
  }

  const getCarDisplay = () => {
    if (claim.car_type === "external") {
      return claim.external_car_number 
        ? `${claim.external_car_number} ${claim.external_car_model || ""}`
        : "سيارة خارجية";
    }
    if (claim.client) {
      return claim.client.full_name;
    }
    return "مؤمن";
  };

  return (
    <MainLayout>
      <div className="flex items-center gap-4 p-4 border-b">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/claims")}>
          ← المطالبات
        </Button>
        <div>
          <h1 className="text-lg font-semibold">مطالبة {claim.claim_number}</h1>
          <p className="text-sm text-muted-foreground">{claim.garage_name}</p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Claim Details Card */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">تفاصيل المطالبة</CardTitle>
                <Badge className={STATUS_CONFIG[claim.status as ClaimStatus].color}>
                  {STATUS_CONFIG[claim.status as ClaimStatus].label}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">كراج:</span>
                    <span className="font-medium">{claim.garage_name}</span>
                  </div>
                  
                  {claim.insurance_company && (
                    <div className="flex items-center gap-2 text-sm">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">شركة:</span>
                      <span className="font-medium">
                        {claim.insurance_company.name_ar || claim.insurance_company.name}
                      </span>
                    </div>
                  )}
                  
                  {claim.insurance_file_number && (
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">رقم الملف:</span>
                      <span className="font-medium">{claim.insurance_file_number}</span>
                    </div>
                  )}
                  
                  {claim.accident_date && (
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">تاريخ الحادث:</span>
                      <span className="font-medium">
                        {format(new Date(claim.accident_date), "dd/MM/yyyy", { locale: ar })}
                      </span>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-2 text-sm">
                    <Car className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">السيارة:</span>
                    <span className="font-medium">{getCarDisplay()}</span>
                  </div>

                  {claim.policy && (
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">البوليصة:</span>
                      <span className="font-medium">
                        {claim.policy.policy_type_parent === "THIRD_FULL" ? "شامل" : "خدمات طريق"}
                        {claim.policy.policy_number ? ` - ${claim.policy.policy_number}` : ""}
                      </span>
                    </div>
                  )}
                </div>

                {claim.notes && (
                  <div className="pt-4 border-t">
                    <p className="text-sm text-muted-foreground mb-1">ملاحظات:</p>
                    <p className="text-sm">{claim.notes}</p>
                  </div>
                )}

                {claim.status === "completed" && (
                  <div className="pt-4 border-t space-y-2">
                    <p className="text-sm text-muted-foreground">وصف التصليحات:</p>
                    <p className="text-sm">{claim.repairs_description}</p>
                    <p className="text-lg font-bold text-primary">
                      المبلغ: ₪{claim.total_amount?.toLocaleString()}
                    </p>
                  </div>
                )}

                {/* Status Actions */}
                {claim.status !== "completed" && (
                  <div className="pt-4 border-t flex flex-wrap gap-2">
                    {claim.status === "open" && (
                      <Button 
                        variant="outline" 
                        onClick={() => updateStatusMutation.mutate("in_progress")}
                      >
                        بدء التنفيذ
                      </Button>
                    )}
                    <Button 
                      onClick={() => setCloseDialogOpen(true)}
                      className="bg-primary hover:bg-primary/90"
                    >
                      <CheckCircle className="h-4 w-4 ml-1" />
                      إغلاق الملف
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Notes Timeline */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  الملاحظات ({notes?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Add Note Form */}
                <div className="flex gap-2">
                  <Textarea
                    placeholder="أضف ملاحظة..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    className="flex-1"
                    rows={2}
                  />
                  <Button 
                    onClick={() => newNote.trim() && addNoteMutation.mutate(newNote.trim())}
                    disabled={!newNote.trim() || addNoteMutation.isPending}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Notes List */}
                <div className="space-y-3">
                  {notes?.map((note) => (
                    <div 
                      key={note.id} 
                      className="p-3 rounded-lg bg-muted/50 border-r-4 border-primary"
                    >
                      <p className="text-sm">{note.note}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {format(new Date(note.created_at), "dd/MM/yyyy HH:mm", { locale: ar })}
                      </p>
                    </div>
                  ))}
                  {(!notes || notes.length === 0) && (
                    <p className="text-center text-muted-foreground text-sm py-4">
                      لا توجد ملاحظات
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Reminders */}
          <div>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  التذكيرات
                </CardTitle>
                <Button size="sm" onClick={() => setReminderDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {reminders?.map((reminder) => (
                  <div 
                    key={reminder.id}
                    className={`p-3 rounded-lg border ${
                      reminder.is_done ? "bg-muted/30 opacity-60" : "bg-background"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {REMINDER_TYPES.find(t => t.value === reminder.reminder_type)?.label}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(reminder.reminder_date), "dd/MM/yyyy", { locale: ar })}
                          </span>
                        </div>
                        {reminder.message && (
                          <p className="text-sm">{reminder.message}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => toggleReminderMutation.mutate({ 
                            id: reminder.id, 
                            is_done: !reminder.is_done 
                          })}
                        >
                          <CheckCircle className={`h-4 w-4 ${
                            reminder.is_done ? "text-green-600" : "text-muted-foreground"
                          }`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deleteReminderMutation.mutate(reminder.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {(!reminders || reminders.length === 0) && (
                  <p className="text-center text-muted-foreground text-sm py-4">
                    لا توجد تذكيرات
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Close Claim Dialog */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إغلاق الملف</DialogTitle>
            <DialogDescription>
              أدخل تفاصيل التصليحات والمبلغ الإجمالي. سيتم إضافة المبلغ تلقائياً للمصاريف.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>وصف التصليحات</Label>
              <Textarea
                value={repairsDescription}
                onChange={(e) => setRepairsDescription(e.target.value)}
                placeholder="وصف التصليحات التي تمت..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>المبلغ الإجمالي (₪)</Label>
              <Input
                type="number"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="0.00"
                dir="ltr"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>
              إلغاء
            </Button>
            <Button 
              onClick={() => closeClaimMutation.mutate()}
              disabled={!repairsDescription.trim() || !totalAmount || closeClaimMutation.isPending}
            >
              إغلاق وإضافة للمصاريف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Reminder Dialog */}
      <Dialog open={reminderDialogOpen} onOpenChange={setReminderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة تذكير</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>التاريخ</Label>
              <ArabicDatePicker
                value={reminderDate}
                onChange={(date) => setReminderDate(date)}
              />
            </div>
            <div className="space-y-2">
              <Label>النوع</Label>
              <Select value={reminderType} onValueChange={setReminderType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>الرسالة (اختياري)</Label>
              <Textarea
                value={reminderMessage}
                onChange={(e) => setReminderMessage(e.target.value)}
                placeholder="تذكير..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReminderDialogOpen(false)}>
              إلغاء
            </Button>
            <Button 
              onClick={() => addReminderMutation.mutate()}
              disabled={!reminderDate || addReminderMutation.isPending}
            >
              إضافة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
