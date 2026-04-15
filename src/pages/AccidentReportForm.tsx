import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowRight,
  Loader2,
  User,
  Car,
  Building2,
  MessageSquare,
  Clock,
  CalendarIcon,
  Check,
  FileImage,
  Pencil,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccidentFilesSection } from "@/components/accident-reports/AccidentFilesSection";

interface Policy {
  id: string;
  policy_number: string | null;
  policy_type_parent: string;
  policy_type_child: string | null;
  start_date: string;
  end_date: string;
  cancelled: boolean | null;
  clients: {
    id: string;
    full_name: string;
    id_number: string;
    phone_number: string | null;
  };
  cars: {
    id: string;
    car_number: string;
    manufacturer_name: string | null;
    model: string | null;
    year: number | null;
    color: string | null;
    license_expiry: string | null;
  } | null;
  insurance_companies: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
}

interface AccidentReport {
  id: string;
  policy_id: string;
  client_id: string;
  car_id: string | null;
  company_id: string | null;
  branch_id: string | null;
  status: string;
  accident_date: string;
  report_number: number;
}

interface AccidentNote {
  id: string;
  note: string;
  created_at: string;
  created_by: { full_name: string | null; email: string } | null;
}

interface AccidentReminder {
  id: string;
  reminder_date: string;
  reminder_text: string | null;
  is_done: boolean;
}

// Status vocabulary used on accident reports. `draft`/`submitted` are
// legacy values still sitting on older rows, so the labels map still
// carries them for display — but we only offer the two new statuses
// ("قيد التحقيق" / "مغلق") in the dropdown going forward.
const statusLabels: Record<string, string> = {
  investigating: "قيد التحقيق",
  closed: "مغلق",
  // Legacy rows
  draft: "مسودة",
  submitted: "مُقدَّم",
};

const statusColors: Record<string, string> = {
  investigating: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  closed: "bg-green-500/10 text-green-700 border-green-500/20",
  draft: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  submitted: "bg-blue-500/10 text-blue-700 border-blue-500/20",
};

// Options offered in the dropdown — drop the legacy draft/submitted
// values so staff pick from the new two.
const selectableStatuses: string[] = ["investigating", "closed"];

// Inline editable field component
function EditableField({ label, value, onSave, toast }: { label: string; value: string; onSave: (val: string) => Promise<void>; toast: any }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
      toast({ title: "تم الحفظ" });
    } catch {
      toast({ title: "خطأ", description: "فشل في الحفظ", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      {editing ? (
        <div className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="h-9" />
          <Button size="sm" onClick={handleSave} disabled={saving} className="h-9">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(value); }} className="h-9">✕</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setEditing(true)}>
          <p className="font-medium">{value || "-"}</p>
          <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      )}
    </div>
  );
}

function EditableDateField({ label, value, onSave, toast }: { label: string; value: string; onSave: (val: string) => Promise<void>; toast: any }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSelect = async (date: Date | undefined) => {
    if (!date) return;
    const formatted = format(date, "yyyy-MM-dd");
    if (formatted === value) { setOpen(false); return; }
    setSaving(true);
    try {
      await onSave(formatted);
      setOpen(false);
      toast({ title: "تم الحفظ" });
    } catch {
      toast({ title: "خطأ", description: "فشل في الحفظ", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 justify-start text-right gap-2">
            <CalendarIcon className="h-4 w-4" />
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (value ? new Date(value).toLocaleDateString("en-GB") : "-")}
            <Pencil className="h-3.5 w-3.5 text-muted-foreground mr-auto" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar mode="single" selected={value ? new Date(value) : undefined} onSelect={handleSelect} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function AccidentReportForm() {
  const { policyId, reportId } = useParams<{ policyId?: string; reportId?: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile, branchId } = useAuth();

  const [resolvedPolicyId, setResolvedPolicyId] = useState<string | null>(policyId || null);
  const [loading, setLoading] = useState(true);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [report, setReport] = useState<AccidentReport | null>(null);

  // Notes & Reminders state
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [reportNotes, setReportNotes] = useState<AccidentNote[]>([]);
  const [reminders, setReminders] = useState<AccidentReminder[]>([]);
  const [notesCount, setNotesCount] = useState(0);
  const [hasActiveReminder, setHasActiveReminder] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingReminders, setLoadingReminders] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [newReminderDate, setNewReminderDate] = useState<Date | undefined>();
  const [newReminderText, setNewReminderText] = useState("");
  const [addingReminder, setAddingReminder] = useState(false);

  const fetchPolicyById = useCallback(async (pid: string) => {
    const { data, error } = await supabase
      .from("policies")
      .select(`
        id, policy_number, policy_type_parent, policy_type_child,
        start_date, end_date, cancelled,
        clients!inner(id, full_name, id_number, phone_number),
        cars(id, car_number, manufacturer_name, model, year, color, license_expiry),
        insurance_companies(id, name, name_ar)
      `)
      .eq("id", pid)
      .single();

    if (error) {
      console.error("Error fetching policy:", error);
      toast({ title: "خطأ", description: "فشل في تحميل بيانات الوثيقة", variant: "destructive" });
      return null;
    }
    return data as Policy;
  }, [toast]);

  const fetchReportById = useCallback(async (rid: string) => {
    const { data, error } = await supabase
      .from("accident_reports")
      .select("id, policy_id, client_id, car_id, company_id, branch_id, status, accident_date, report_number")
      .eq("id", rid)
      .single();

    if (error) {
      console.error("Error fetching report:", error);
      toast({ title: "خطأ", description: "فشل في تحميل بلاغ الحادث", variant: "destructive" });
      return null;
    }
    return data as AccidentReport;
  }, [toast]);

  const fetchNotesAndReminders = async (rid: string) => {
    const { count } = await supabase
      .from("accident_report_notes")
      .select("id", { count: "exact", head: true })
      .eq("accident_report_id", rid);
    setNotesCount(count || 0);

    const { data: reminderData } = await supabase
      .from("accident_report_reminders")
      .select("id")
      .eq("accident_report_id", rid)
      .eq("is_done", false)
      .limit(1);
    setHasActiveReminder((reminderData?.length || 0) > 0);
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!report) return;
    try {
      const { error } = await supabase
        .from("accident_reports")
        .update({ status: newStatus })
        .eq("id", report.id);
      if (error) throw error;
      setReport({ ...report, status: newStatus });
      toast({ title: "تم التحديث", description: "تم تحديث حالة البلاغ" });
    } catch (error) {
      console.error("Error updating status:", error);
      toast({ title: "خطأ", description: "فشل في تحديث الحالة", variant: "destructive" });
    }
  };

  // Notes dialog functions
  const openNoteDialog = async () => {
    if (!report) return;
    setNoteDialogOpen(true);
    setLoadingNotes(true);
    try {
      const { data, error } = await supabase
        .from("accident_report_notes")
        .select(`id, note, created_at, created_by:profiles(full_name, email)`)
        .eq("accident_report_id", report.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setReportNotes(data || []);
    } catch (error) {
      console.error("Error fetching notes:", error);
    } finally {
      setLoadingNotes(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !report) return;
    setAddingNote(true);
    try {
      const { error } = await supabase
        .from("accident_report_notes")
        .insert({
          accident_report_id: report.id,
          note: newNote.trim(),
          created_by: profile?.id,
        });
      if (error) throw error;
      toast({ title: "تمت الإضافة", description: "تمت إضافة الملاحظة بنجاح" });
      setNewNote("");
      openNoteDialog();
      setNotesCount((prev) => prev + 1);
    } catch (error) {
      console.error("Error adding note:", error);
      toast({ title: "خطأ", description: "فشل في إضافة الملاحظة", variant: "destructive" });
    } finally {
      setAddingNote(false);
    }
  };

  // Reminder dialog functions
  const openReminderDialog = async () => {
    if (!report) return;
    setReminderDialogOpen(true);
    setLoadingReminders(true);
    try {
      const { data, error } = await supabase
        .from("accident_report_reminders")
        .select("id, reminder_date, reminder_text, is_done")
        .eq("accident_report_id", report.id)
        .order("reminder_date", { ascending: true });
      if (error) throw error;
      setReminders(data || []);
    } catch (error) {
      console.error("Error fetching reminders:", error);
    } finally {
      setLoadingReminders(false);
    }
  };

  const handleAddReminder = async () => {
    if (!newReminderDate || !report) return;
    setAddingReminder(true);
    try {
      const { error } = await supabase
        .from("accident_report_reminders")
        .insert({
          accident_report_id: report.id,
          reminder_date: format(newReminderDate, "yyyy-MM-dd"),
          reminder_text: newReminderText.trim() || null,
          created_by: profile?.id,
        });
      if (error) throw error;
      toast({ title: "تم التعيين", description: "تم تعيين التذكير بنجاح" });
      setNewReminderDate(undefined);
      setNewReminderText("");
      openReminderDialog();
      setHasActiveReminder(true);
    } catch (error) {
      console.error("Error adding reminder:", error);
      toast({ title: "خطأ", description: "فشل في تعيين التذكير", variant: "destructive" });
    } finally {
      setAddingReminder(false);
    }
  };

  const handleToggleReminderDone = async (reminderId: string, isDone: boolean) => {
    try {
      const { error } = await supabase
        .from("accident_report_reminders")
        .update({ is_done: isDone })
        .eq("id", reminderId);
      if (error) throw error;
      openReminderDialog();
      if (isDone && report) {
        fetchNotesAndReminders(report.id);
      }
    } catch (error) {
      console.error("Error toggling reminder:", error);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);

      if (reportId && reportId !== "new" && !policyId) {
        const reportData = await fetchReportById(reportId);
        if (reportData) {
          setReport(reportData);
          setResolvedPolicyId(reportData.policy_id);
          const policyData = await fetchPolicyById(reportData.policy_id);
          if (policyData) setPolicy(policyData);
          await fetchNotesAndReminders(reportId);
        }
      } else if (policyId) {
        const policyData = await fetchPolicyById(policyId);
        if (policyData) setPolicy(policyData);

        if (reportId && reportId !== "new") {
          const reportData = await fetchReportById(reportId);
          if (reportData) {
            setReport(reportData);
            await fetchNotesAndReminders(reportId);
          }
        } else {
          // Auto-create a new report for the upload workflow
          try {
            const { data, error } = await supabase
              .from("accident_reports")
              .insert({
                policy_id: policyId,
                client_id: policyData?.clients.id,
                car_id: policyData?.cars?.id || null,
                company_id: policyData?.insurance_companies?.id || null,
                branch_id: branchId || null,
                accident_date: format(new Date(), "yyyy-MM-dd"),
                created_by_admin_id: profile?.id,
                status: "investigating",
              })
              .select("id, policy_id, client_id, car_id, company_id, branch_id, status, accident_date, report_number")
              .single();

            if (error) throw error;
            setReport(data as AccidentReport);
            navigate(`/policies/${policyId}/accident/${data.id}`, { replace: true });
          } catch (error) {
            console.error("Error creating report:", error);
            toast({ title: "خطأ", description: "فشل في إنشاء البلاغ", variant: "destructive" });
          }
        }
      }

      setLoading(false);
    };
    init();
  }, [policyId, reportId, fetchPolicyById, fetchReportById]);

  if (loading) {
    return (
      <MainLayout>
        <div className="p-6 space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }

  if (!policy) {
    return (
      <MainLayout>
        <div className="p-6 text-center">
          <p className="text-muted-foreground">لم يتم العثور على الوثيقة</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/accidents")}>
            <ArrowRight className="h-4 w-4 ml-2" />
            العودة للقائمة
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/accidents")}>
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">بلاغ حادث</h1>
              {report && (
                <p className="text-sm text-muted-foreground">
                  رقم البلاغ: {report.report_number}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Status */}
            {report && (
              <Select value={report.status} onValueChange={handleStatusChange}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectableStatuses.map((value) => (
                    <SelectItem
                      key={value}
                      value={value}
                      // Kill the default dark focus/hover paint — the
                      // status pills already carry their own color, a
                      // navy highlight on top looks like a missing
                      // state.
                      className="focus:!bg-muted/60 focus:!text-foreground data-[state=checked]:!bg-muted/40"
                    >
                      <Badge variant="outline" className={cn("text-xs", statusColors[value])}>
                        {statusLabels[value]}
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Notes button */}
            {report && (
              <Button variant="outline" size="sm" onClick={openNoteDialog} className="relative">
                <MessageSquare className="h-4 w-4 ml-1" />
                ملاحظات
                {notesCount > 0 && (
                  <Badge className="absolute -top-2 -left-2 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                    {notesCount}
                  </Badge>
                )}
              </Button>
            )}

            {/* Reminders button */}
            {report && (
              <Button variant="outline" size="sm" onClick={openReminderDialog} className="relative">
                <Clock className="h-4 w-4 ml-1" />
                تذكيرات
                {hasActiveReminder && (
                  <span className="absolute -top-1 -left-1 h-3 w-3 bg-orange-500 rounded-full animate-pulse" />
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Policy Info Card + Editable Fields */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">العميل</p>
                  <p className="font-medium">{policy.clients.full_name}</p>
                  <p className="text-xs text-muted-foreground">{policy.clients.id_number}</p>
                </div>
              </div>

              {policy.cars && (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Car className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">المركبة</p>
                    <p className="font-medium">{policy.cars.car_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {[policy.cars.manufacturer_name, policy.cars.model, policy.cars.year].filter(Boolean).join(" ")}
                    </p>
                  </div>
                </div>
              )}

              {policy.insurance_companies && (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">شركة التأمين</p>
                    <p className="font-medium">
                      {policy.insurance_companies.name_ar || policy.insurance_companies.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      وثيقة: {policy.policy_number || "-"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Editable Policy Number & Accident Date */}
            {report && (
              <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <EditableField
                  label="رقم البوليصة"
                  value={policy.policy_number || ""}
                  onSave={async (val) => {
                    const { error } = await supabase
                      .from("policies")
                      .update({ policy_number: val || null })
                      .eq("id", policy.id);
                    if (error) throw error;
                    setPolicy({ ...policy, policy_number: val || null });
                  }}
                  toast={toast}
                />
                <EditableDateField
                  label="تاريخ الحادث"
                  value={report.accident_date}
                  onSave={async (val) => {
                    const { error } = await supabase
                      .from("accident_reports")
                      .update({ accident_date: val })
                      .eq("id", report.id);
                    if (error) throw error;
                    setReport({ ...report, accident_date: val });
                  }}
                  toast={toast}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Files Section - Main Area */}
        {report && (
          <AccidentFilesSection
            accidentReportId={report.id}
            policyNumber={policy.policy_number}
            accidentDate={report.accident_date}
            clientName={policy.clients.full_name}
            carNumber={policy.cars?.car_number}
            companyName={policy.insurance_companies?.name_ar || policy.insurance_companies?.name}
            reportNumber={report.report_number}
          />
        )}

        {/* Notes Dialog */}
        <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>ملاحظات البلاغ</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="أضف ملاحظة..."
                  className="min-h-[60px]"
                />
                <Button onClick={handleAddNote} disabled={addingNote || !newNote.trim()} size="sm">
                  {addingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : "إضافة"}
                </Button>
              </div>
              <div className="max-h-[300px] overflow-y-auto space-y-3">
                {loadingNotes ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : reportNotes.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">لا توجد ملاحظات</p>
                ) : (
                  reportNotes.map((note) => (
                    <div key={note.id} className="border rounded-lg p-3 space-y-1">
                      <p className="text-sm">{note.note}</p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{note.created_by?.full_name || note.created_by?.email || "غير معروف"}</span>
                        <span>{new Date(note.created_at).toLocaleDateString("en-GB")}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Reminders Dialog */}
        <Dialog open={reminderDialogOpen} onOpenChange={setReminderDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>تذكيرات البلاغ</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2 border rounded-lg p-3">
                <p className="text-sm font-medium">إضافة تذكير جديد</p>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-right">
                      <CalendarIcon className="ml-2 h-4 w-4" />
                      {newReminderDate ? format(newReminderDate, "dd/MM/yyyy") : "اختر تاريخ التذكير"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={newReminderDate} onSelect={setNewReminderDate} />
                  </PopoverContent>
                </Popover>
                <Textarea
                  value={newReminderText}
                  onChange={(e) => setNewReminderText(e.target.value)}
                  placeholder="نص التذكير (اختياري)"
                  className="min-h-[40px]"
                />
                <Button
                  onClick={handleAddReminder}
                  disabled={addingReminder || !newReminderDate}
                  size="sm"
                  className="w-full"
                >
                  {addingReminder ? <Loader2 className="h-4 w-4 animate-spin" /> : "إضافة تذكير"}
                </Button>
              </div>

              <div className="max-h-[250px] overflow-y-auto space-y-2">
                {loadingReminders ? (
                  <Skeleton className="h-16 w-full" />
                ) : reminders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">لا توجد تذكيرات</p>
                ) : (
                  reminders.map((reminder) => (
                    <div
                      key={reminder.id}
                      className={cn(
                        "border rounded-lg p-3 flex items-center justify-between",
                        reminder.is_done && "opacity-50"
                      )}
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {new Date(reminder.reminder_date).toLocaleDateString("en-GB")}
                        </p>
                        {reminder.reminder_text && (
                          <p className="text-xs text-muted-foreground">{reminder.reminder_text}</p>
                        )}
                      </div>
                      <Button
                        variant={reminder.is_done ? "outline" : "default"}
                        size="sm"
                        onClick={() => handleToggleReminderDone(reminder.id, !reminder.is_done)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
