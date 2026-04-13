import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  MessageSquare, 
  Plus, 
  Trash2, 
  Calendar, 
  User,
  Loader2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { arDZ as ar } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog';

interface ClientNote {
  id: string;
  note: string;
  created_at: string;
  created_by: string | null;
  creator_name?: string;
}

interface ClientNotesSectionProps {
  clientId: string;
  branchId: string | null;
}

export function ClientNotesSection({ clientId, branchId }: ClientNotesSectionProps) {
  const { profile, isSuperAdmin } = useAuth();
  const userId = profile?.id;
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchNotes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('client_notes')
        .select('id, note, created_at, created_by')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch creator names
      const creatorIds = [...new Set((data || []).map(n => n.created_by).filter(Boolean))];
      let creatorMap: Record<string, string> = {};
      
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', creatorIds);
        
        creatorMap = (profiles || []).reduce((acc, p) => {
          acc[p.id] = p.full_name || p.email || 'مستخدم';
          return acc;
        }, {} as Record<string, string>);
      }

      setNotes((data || []).map(n => ({
        ...n,
        creator_name: n.created_by ? creatorMap[n.created_by] || 'مستخدم' : 'غير معروف',
      })));
    } catch (error) {
      console.error('Error fetching notes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) {
      fetchNotes();
    }
  }, [clientId]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    
    setAdding(true);
    try {
      const { error } = await supabase
        .from('client_notes')
        .insert({
          client_id: clientId,
          note: newNote.trim(),
          created_by: userId,
          branch_id: branchId,
        });

      if (error) throw error;

      toast.success('تم إضافة الملاحظة');
      setNewNote('');
      fetchNotes();
    } catch (error: any) {
      console.error('Error adding note:', error);
      toast.error('خطأ في إضافة الملاحظة');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!deleteNoteId) return;
    
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('client_notes')
        .delete()
        .eq('id', deleteNoteId);

      if (error) throw error;

      toast.success('تم حذف الملاحظة');
      setDeleteNoteId(null);
      fetchNotes();
    } catch (error: any) {
      console.error('Error deleting note:', error);
      toast.error('خطأ في حذف الملاحظة');
    } finally {
      setDeleting(false);
    }
  };

  const canDelete = (note: ClientNote) => {
    return isSuperAdmin || note.created_by === userId;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add Note Form */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="أضف ملاحظة جديدة... (مثل: العميل طلب الاتصال غداً)"
            rows={2}
            className="flex-1"
          />
          <Button 
            onClick={handleAddNote} 
            disabled={!newNote.trim() || adding}
            className="shrink-0"
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="h-4 w-4 ml-2" />
                إضافة
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* Notes Timeline */}
      {notes.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>لا توجد ملاحظات حتى الآن</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute top-0 bottom-0 right-4 w-0.5 bg-border" />
          
          <div className="space-y-4">
            {notes.map((note, index) => (
              <div key={note.id} className="relative flex gap-4">
                {/* Timeline dot */}
                <div className="relative z-10 w-8 h-8 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center shrink-0">
                  <MessageSquare className="h-4 w-4 text-primary" />
                </div>

                {/* Note content */}
                <Card className="flex-1 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      {/* Date and Author */}
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(note.created_at), 'dd/MM/yyyy HH:mm', { locale: ar })}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="h-3.5 w-3.5" />
                          {note.creator_name}
                        </span>
                      </div>
                      
                      {/* Note text */}
                      <p className="text-foreground whitespace-pre-wrap">{note.note}</p>
                    </div>

                    {/* Delete button */}
                    {canDelete(note) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteNoteId(note.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </Card>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={!!deleteNoteId}
        onOpenChange={(open) => !open && setDeleteNoteId(null)}
        onConfirm={handleDeleteNote}
        title="حذف الملاحظة"
        description="هل أنت متأكد من حذف هذه الملاحظة؟"
        loading={deleting}
      />
    </div>
  );
}
