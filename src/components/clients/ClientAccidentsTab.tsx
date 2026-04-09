import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertTriangle,
  Eye,
  MessageSquare,
  Clock,
  Save,
  Plus,
  CalendarIcon,
  Loader2,
  Check,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

interface AccidentReport {
  id: string;
  accident_date: string;
  status: string;
  report_number: number;
  car: { id: string; car_number: string } | null;
  company: { name: string; name_ar: string | null } | null;
  notes_count?: number;
  has_reminder?: boolean;
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

interface ClientAccidentsTabProps {
  clientId: string;
  accidentNotes: string | null;
  onAccidentNotesUpdated: () => void;
}

const statusLabels: Record<string, string> = {
  draft: 'مسودة',
  submitted: 'مُقدَّم',
  closed: 'مُغلق',
};

const statusColors: Record<string, string> = {
  draft: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  submitted: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  closed: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

export function ClientAccidentsTab({ clientId, accidentNotes, onAccidentNotesUpdated }: ClientAccidentsTabProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [reports, setReports] = useState<AccidentReport[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Accident notes editing
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(accidentNotes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  
  // Note dialog
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reportNotes, setReportNotes] = useState<AccidentNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  
  // Reminder dialog
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [selectedReminderReportId, setSelectedReminderReportId] = useState<string | null>(null);
  const [reminders, setReminders] = useState<AccidentReminder[]>([]);
  const [loadingReminders, setLoadingReminders] = useState(false);
  const [newReminderDate, setNewReminderDate] = useState<Date | undefined>();
  const [newReminderText, setNewReminderText] = useState('');
  const [addingReminder, setAddingReminder] = useState(false);

  // Update local state when prop changes
  useEffect(() => {
    setNotesValue(accidentNotes || '');
  }, [accidentNotes]);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('accident_reports')
        .select(`
          id,
          accident_date,
          status,
          report_number,
          car:cars(id, car_number),
          company:insurance_companies(name, name_ar)
        `)
        .eq('client_id', clientId)
        .order('accident_date', { ascending: false });

      if (error) throw error;

      // Fetch notes count and reminders for each report
      const reportsWithMeta = await Promise.all(
        (data || []).map(async (report) => {
          const [notesResult, remindersResult] = await Promise.all([
            supabase
              .from('accident_report_notes')
              .select('id', { count: 'exact', head: true })
              .eq('accident_report_id', report.id),
            supabase
              .from('accident_report_reminders')
              .select('id')
              .eq('accident_report_id', report.id)
              .eq('is_done', false)
              .limit(1),
          ]);

          return {
            ...report,
            notes_count: notesResult.count || 0,
            has_reminder: (remindersResult.data?.length || 0) > 0,
          };
        })
      );

      setReports(reportsWithMeta);
    } catch (error) {
      console.error('Error fetching accident reports:', error);
      toast.error('فشل في تحميل بلاغات الحوادث');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [clientId]);

  const handleSaveAccidentNotes = async () => {
    setSavingNotes(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ accident_notes: notesValue || null })
        .eq('id', clientId);

      if (error) throw error;
      toast.success('تم حفظ ملاحظات الحوادث');
      setEditingNotes(false);
      onAccidentNotesUpdated();
    } catch (error) {
      console.error('Error saving accident notes:', error);
      toast.error('فشل في حفظ الملاحظات');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleStatusChange = async (reportId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('accident_reports')
        .update({ status: newStatus })
        .eq('id', reportId);

      if (error) throw error;
      toast.success('تم تحديث الحالة');
      fetchReports();
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('فشل في تحديث الحالة');
    }
  };

  // Notes functions
  const openNoteDialog = async (reportId: string) => {
    setSelectedReportId(reportId);
    setNoteDialogOpen(true);
    setLoadingNotes(true);

    try {
      const { data, error } = await supabase
        .from('accident_report_notes')
        .select(`
          id,
          note,
          created_at,
          created_by:profiles(full_name, email)
        `)
        .eq('accident_report_id', reportId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setReportNotes(data || []);
    } catch (error) {
      console.error('Error fetching notes:', error);
    } finally {
      setLoadingNotes(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedReportId) return;
    setAddingNote(true);

    try {
      const { error } = await supabase
        .from('accident_report_notes')
        .insert({
          accident_report_id: selectedReportId,
          note: newNote.trim(),
          created_by: profile?.id,
        });

      if (error) throw error;
      toast.success('تمت إضافة الملاحظة');
      setNewNote('');
      openNoteDialog(selectedReportId); // Refresh notes
      fetchReports(); // Refresh count
    } catch (error) {
      console.error('Error adding note:', error);
      toast.error('فشل في إضافة الملاحظة');
    } finally {
      setAddingNote(false);
    }
  };

  // Reminder functions
  const openReminderDialog = async (reportId: string) => {
    setSelectedReminderReportId(reportId);
    setReminderDialogOpen(true);
    setLoadingReminders(true);

    try {
      const { data, error } = await supabase
        .from('accident_report_reminders')
        .select('id, reminder_date, reminder_text, is_done')
        .eq('accident_report_id', reportId)
        .order('reminder_date', { ascending: true });

      if (error) throw error;
      setReminders(data || []);
    } catch (error) {
      console.error('Error fetching reminders:', error);
    } finally {
      setLoadingReminders(false);
    }
  };

  const handleAddReminder = async () => {
    if (!newReminderDate || !selectedReminderReportId) return;
    setAddingReminder(true);

    try {
      const { error } = await supabase
        .from('accident_report_reminders')
        .insert({
          accident_report_id: selectedReminderReportId,
          reminder_date: format(newReminderDate, 'yyyy-MM-dd'),
          reminder_text: newReminderText.trim() || null,
          created_by: profile?.id,
        });

      if (error) throw error;
      toast.success('تم تعيين التذكير');
      setNewReminderDate(undefined);
      setNewReminderText('');
      openReminderDialog(selectedReminderReportId);
      fetchReports();
    } catch (error) {
      console.error('Error adding reminder:', error);
      toast.error('فشل في تعيين التذكير');
    } finally {
      setAddingReminder(false);
    }
  };

  const handleToggleReminderDone = async (reminderId: string, isDone: boolean) => {
    try {
      const { error } = await supabase
        .from('accident_report_reminders')
        .update({ is_done: isDone })
        .eq('id', reminderId);

      if (error) throw error;
      if (selectedReminderReportId) {
        openReminderDialog(selectedReminderReportId);
      }
      fetchReports();
    } catch (error) {
      console.error('Error toggling reminder:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* General Accident Notes Section */}
      <Card className="p-6 border-amber-500/30 bg-amber-500/5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg flex items-center gap-2 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
            ملاحظات الحوادث العامة
          </h3>
          {!editingNotes ? (
            <Button variant="outline" size="sm" onClick={() => setEditingNotes(true)}>
              تعديل
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveAccidentNotes} disabled={savingNotes}>
                {savingNotes ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 ml-2" />}
                حفظ
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                setEditingNotes(false);
                setNotesValue(accidentNotes || '');
              }}>
                إلغاء
              </Button>
            </div>
          )}
        </div>
        
        {editingNotes ? (
          <Textarea
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            placeholder="أضف ملاحظات خاصة بالحوادث هنا (مثال: هذا المؤمن لديه 5 حوادث، لا نرغب بتأمين هذه المركبة له)"
            className="min-h-[100px] resize-none"
          />
        ) : (
          <div className="min-h-[60px] p-4 bg-amber-50 rounded-lg border border-amber-200">
            {accidentNotes ? (
              <p className="whitespace-pre-wrap text-amber-800">{accidentNotes}</p>
            ) : (
              <p className="text-amber-600/60 text-center">
                لا توجد ملاحظات حوادث. اضغط "تعديل" لإضافة ملاحظات.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Accident Reports Table */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            بلاغات الحوادث ({reports.length})
          </h3>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : reports.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>لا توجد بلاغات حوادث مسجلة</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-right">رقم البلاغ</TableHead>
                <TableHead className="text-right">تاريخ الحادث</TableHead>
                <TableHead className="text-right">السيارة</TableHead>
                <TableHead className="text-right">الشركة</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">ملاحظات</TableHead>
                <TableHead className="text-right">تذكير</TableHead>
                <TableHead className="text-right w-[80px]">عرض</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="font-mono font-semibold">
                    #{report.report_number}
                  </TableCell>
                  <TableCell className="ltr-nums">
                    {format(new Date(report.accident_date), 'dd/MM/yyyy')}
                  </TableCell>
                  <TableCell>
                    {report.car ? (
                      <Badge variant="outline" className="font-mono">
                        {report.car.car_number}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {report.company?.name_ar || report.company?.name || '-'}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={report.status}
                      onValueChange={(value) => handleStatusChange(report.id, value)}
                    >
                      <SelectTrigger className={cn("w-[110px] h-8", statusColors[report.status])}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">مسودة</SelectItem>
                        <SelectItem value="submitted">مُقدَّم</SelectItem>
                        <SelectItem value="closed">مُغلق</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      onClick={() => openNoteDialog(report.id)}
                    >
                      <MessageSquare className="h-4 w-4" />
                      {(report.notes_count || 0) > 0 && (
                        <span className="text-xs">({report.notes_count})</span>
                      )}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant={report.has_reminder ? "default" : "ghost"}
                      size="sm"
                      className="gap-1"
                      onClick={() => openReminderDialog(report.id)}
                    >
                      <Clock className={cn("h-4 w-4", report.has_reminder && "animate-pulse")} />
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigate(`/accidents/${report.id}`)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Notes Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ملاحظات البلاغ</DialogTitle>
          </DialogHeader>
          
          {/* Add new note */}
          <div className="space-y-2">
            <Textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="أضف ملاحظة جديدة..."
              className="min-h-[80px]"
            />
            <Button
              size="sm"
              onClick={handleAddNote}
              disabled={!newNote.trim() || addingNote}
              className="w-full"
            >
              {addingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 ml-2" />}
              إضافة ملاحظة
            </Button>
          </div>

          {/* Notes list */}
          <div className="mt-4 space-y-3 max-h-[300px] overflow-y-auto">
            {loadingNotes ? (
              <Skeleton className="h-20 w-full" />
            ) : reportNotes.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">لا توجد ملاحظات</p>
            ) : (
              reportNotes.map((note) => (
                <div key={note.id} className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm whitespace-pre-wrap">{note.note}</p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <span>{note.created_by?.full_name || note.created_by?.email || 'مستخدم'}</span>
                    <span>•</span>
                    <span className="ltr-nums">{format(new Date(note.created_at), 'dd/MM/yyyy HH:mm')}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Reminder Dialog */}
      <Dialog open={reminderDialogOpen} onOpenChange={setReminderDialogOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>تذكيرات البلاغ</DialogTitle>
          </DialogHeader>
          
          {/* Add new reminder */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>تاريخ التذكير</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-right">
                    <CalendarIcon className="h-4 w-4 ml-2" />
                    {newReminderDate ? format(newReminderDate, 'dd/MM/yyyy') : 'اختر تاريخ'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={newReminderDate}
                    onSelect={setNewReminderDate}
                    disabled={(date) => date < new Date()}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>ملاحظة التذكير (اختياري)</Label>
              <Input
                value={newReminderText}
                onChange={(e) => setNewReminderText(e.target.value)}
                placeholder="مثال: متابعة مع الشركة"
              />
            </div>
            <Button
              size="sm"
              onClick={handleAddReminder}
              disabled={!newReminderDate || addingReminder}
              className="w-full"
            >
              {addingReminder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 ml-2" />}
              إضافة تذكير
            </Button>
          </div>

          {/* Reminders list */}
          <div className="mt-4 space-y-2 max-h-[200px] overflow-y-auto">
            {loadingReminders ? (
              <Skeleton className="h-12 w-full" />
            ) : reminders.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">لا توجد تذكيرات</p>
            ) : (
              reminders.map((reminder) => (
                <div
                  key={reminder.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border",
                    reminder.is_done ? "bg-muted/30 opacity-60" : "bg-primary/5 border-primary/20"
                  )}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => handleToggleReminderDone(reminder.id, !reminder.is_done)}
                  >
                    {reminder.is_done ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Clock className="h-4 w-4" />
                    )}
                  </Button>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium ltr-nums", reminder.is_done && "line-through")}>
                      {format(new Date(reminder.reminder_date), 'dd/MM/yyyy')}
                    </p>
                    {reminder.reminder_text && (
                      <p className="text-xs text-muted-foreground truncate">{reminder.reminder_text}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
