import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Megaphone } from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  content: string;
  show_once: boolean;
}

export function AnnouncementPopup() {
  const { user } = useAuth();
  const { agentId } = useAgentContext();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [open, setOpen] = useState(false);

  const fetchAnnouncement = async () => {
    if (!user?.id) return;

    // Get active announcements: either for this agent or for all agents (agent_id is null)
    let query = supabase
      .from("announcements")
      .select("id, title, content, show_once")
      .eq("is_active", true)
      .lte("start_date", new Date().toISOString())
      .gte("end_date", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    // Filter: agent_id is null (all agents) OR matches current agent
    if (agentId) {
      query = query.or(`agent_id.is.null,agent_id.eq.${agentId}`);
    } else {
      query = query.is("agent_id", null);
    }

    const { data: announcements, error } = await query;

    if (error || !announcements?.length) return;

    const ann = announcements[0];

    // Check if user dismissed this announcement
    const { data: dismissal } = await supabase
      .from("announcement_dismissals")
      .select("id")
      .eq("announcement_id", ann.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (ann.show_once && dismissal) return;
    if (!ann.show_once && dismissal) return;

    setAnnouncement(ann);
    setOpen(true);
  };

  useEffect(() => {
    if (!user?.id) return;
    fetchAnnouncement();
  }, [user?.id, agentId]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel("announcements-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "announcements" },
        () => fetchAnnouncement()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, agentId]);

  const handleDismiss = async () => {
    if (!announcement || !user?.id) return;

    await supabase.from("announcement_dismissals").upsert(
      {
        announcement_id: announcement.id,
        user_id: user.id,
        dismissed_at: new Date().toISOString(),
      },
      { onConflict: "announcement_id,user_id" }
    );

    setOpen(false);
  };

  if (!announcement) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary">
            <Megaphone className="h-5 w-5" />
            {announcement.title}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-base text-foreground whitespace-pre-wrap leading-relaxed">
          {announcement.content}
        </DialogDescription>
        <DialogFooter>
          <Button onClick={handleDismiss} className="w-full">
            فهمت
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
