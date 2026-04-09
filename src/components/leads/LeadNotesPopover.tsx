import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface LeadNotesPopoverProps {
  leadId: string;
  currentNotes: string | null;
}

export function LeadNotesPopover({ leadId, currentNotes }: LeadNotesPopoverProps) {
  const [open, setOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const queryClient = useQueryClient();

  const updateNotes = useMutation({
    mutationFn: async (notes: string) => {
      const { error } = await supabase
        .from("leads")
        .update({ 
          notes,
          updated_at: new Date().toISOString()
        })
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "تم حفظ الملاحظة" });
      setNewNote("");
    },
    onError: () => {
      toast({ title: "حدث خطأ", variant: "destructive" });
    },
  });

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    
    const timestamp = new Date().toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    
    const formattedNote = `[${timestamp}]\n${newNote.trim()}`;
    const updatedNotes = currentNotes 
      ? `${formattedNote}\n\n---\n\n${currentNotes}`
      : formattedNote;
    
    updateNotes.mutate(updatedNotes);
  };

  const hasNotes = currentNotes && currentNotes.trim().length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => e.stopPropagation()}
        >
          <MessageSquare 
            className={`h-4 w-4 ${hasNotes ? "text-primary fill-primary/20" : "text-muted-foreground"}`} 
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-80" 
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <h4 className="font-medium text-sm">الملاحظات</h4>
          
          {/* Add new note */}
          <div className="flex gap-2">
            <Textarea
              placeholder="أضف ملاحظة جديدة..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="min-h-[60px] text-sm resize-none"
            />
          </div>
          <Button
            size="sm"
            onClick={handleAddNote}
            disabled={!newNote.trim() || updateNotes.isPending}
            className="w-full"
          >
            <Send className="h-4 w-4 ml-2" />
            إضافة ملاحظة
          </Button>

          {/* Display existing notes */}
          {hasNotes && (
            <div className="border-t pt-3 mt-3">
              <p className="text-xs text-muted-foreground mb-2">الملاحظات السابقة:</p>
              <div className="max-h-40 overflow-y-auto text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-2">
                {currentNotes}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
