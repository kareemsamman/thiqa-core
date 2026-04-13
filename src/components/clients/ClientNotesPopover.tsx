import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageSquare, Plus, Loader2, Calendar, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { arDZ as ar } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

interface ClientNote {
  id: string;
  note: string;
  created_at: string;
  creator_name?: string;
}

interface ClientNotesPopoverProps {
  clientId: string;
  clientName: string;
  branchId?: string | null;
  className?: string;
}

export function ClientNotesPopover({ 
  clientId, 
  clientName,
  branchId,
  className 
}: ClientNotesPopoverProps) {
  const { profile } = useAuth();
  const userId = profile?.id;
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [notesCount, setNotesCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newNote, setNewNote] = useState('');

  // Fetch notes count on mount
  useEffect(() => {
    const fetchCount = async () => {
      const { count } = await supabase
        .from('client_notes')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId);
      
      setNotesCount(count || 0);
    };
    fetchCount();
  }, [clientId]);

  const fetchNotes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('client_notes')
        .select('id, note, created_at, created_by')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      // Fetch creator names
      const creatorIds = [...new Set((data || []).map(n => n.created_by).filter(Boolean))];
      let creatorMap: Record<string, string> = {};
      
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', creatorIds as string[]);
        
        creatorMap = (profiles || []).reduce((acc, p) => {
          acc[p.id] = p.full_name || p.email || 'مستخدم';
          return acc;
        }, {} as Record<string, string>);
      }

      setNotes((data || []).map(n => ({
        id: n.id,
        note: n.note,
        created_at: n.created_at,
        creator_name: n.created_by ? creatorMap[n.created_by] || 'مستخدم' : 'غير معروف',
      })));
    } catch (error) {
      console.error('Error fetching notes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchNotes();
    }
  }, [open, clientId]);

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
          branch_id: branchId || null,
        });

      if (error) throw error;

      toast.success('تم إضافة الملاحظة');
      setNewNote('');
      setNotesCount(prev => prev + 1);
      fetchNotes();
    } catch (error: any) {
      console.error('Error adding note:', error);
      toast.error('خطأ في إضافة الملاحظة');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("relative", className)}
          onClick={(e) => e.stopPropagation()}
        >
          <MessageSquare className="h-4 w-4" />
          {notesCount > 0 && (
            <Badge 
              variant="secondary" 
              className="absolute -top-1 -left-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
            >
              {notesCount > 9 ? '9+' : notesCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">ملاحظات {clientName}</h4>
            <Badge variant="outline">{notesCount} ملاحظة</Badge>
          </div>

          {/* Add Note Form */}
          <div className="flex gap-2">
            <Textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="أضف ملاحظة سريعة..."
              rows={2}
              className="text-sm"
            />
            <Button 
              size="sm" 
              onClick={handleAddNote} 
              disabled={!newNote.trim() || adding}
              className="shrink-0"
            >
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Notes List */}
          <div className="max-h-48 overflow-auto space-y-2">
            {loading ? (
              <>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </>
            ) : notes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                لا توجد ملاحظات
              </p>
            ) : (
              notes.map((note) => (
                <div key={note.id} className="border rounded-lg p-2 text-sm space-y-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(note.created_at), 'dd/MM HH:mm')}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {note.creator_name}
                    </span>
                  </div>
                  <p className="line-clamp-2">{note.note}</p>
                </div>
              ))
            )}
          </div>

          {notesCount > 5 && (
            <p className="text-xs text-muted-foreground text-center">
              يوجد {notesCount - 5} ملاحظات أخرى
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
