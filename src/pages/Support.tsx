import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { format, isSameDay } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { ArrowRight, LifeBuoy, Loader2, Paperclip, Plus, Send, X, Image as ImageIcon, Video, FileText, Download, ShieldCheck, MessageCircle } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { cn } from "@/lib/utils";

interface Category {
  id: string;
  parent_id: string | null;
  name_ar: string;
  sort_order: number;
  is_active: boolean;
}

interface Ticket {
  id: string;
  ticket_number: string;
  agent_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  subject: string;
  status: "open" | "in_progress" | "done" | "cancelled";
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  ticket_id: string;
  author_user_id: string;
  body: string;
  is_admin_reply: boolean;
  created_at: string;
}

interface Attachment {
  id: string;
  message_id: string;
  file_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
}

interface AuthorProfile {
  full_name: string | null;
  email: string | null;
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || "") + (parts[parts.length - 1][0] || "");
}

const STATUS_LABEL: Record<Ticket["status"], string> = {
  open: "مفتوح",
  in_progress: "قيد المعالجة",
  done: "تم",
  cancelled: "ملغى",
};

const STATUS_TONE: Record<Ticket["status"], string> = {
  open: "bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-300",
  in_progress: "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300",
  done: "bg-green-500/10 border-green-500/40 text-green-700 dark:text-green-300",
  cancelled: "bg-muted border-border text-muted-foreground",
};

export default function Support() {
  const { ticketId } = useParams<{ ticketId?: string }>();
  if (ticketId) return <TicketThread ticketId={ticketId} />;
  return <TicketList />;
}

// ─────────────────────────────────────────────────────────────────
// LIST / CREATE
// ─────────────────────────────────────────────────────────────────
function TicketList() {
  const navigate = useNavigate();
  const { agentId } = useAgentContext();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    fetchTickets();
  }, [agentId]);

  const fetchTickets = async () => {
    setLoading(true);
    // RLS does the visibility gating — creator sees their own,
    // agent admin sees everything for their agent. No client-side
    // filter needed.
    const { data } = await supabase
      .from("support_tickets")
      .select("*")
      .order("updated_at", { ascending: false });
    setTickets((data as Ticket[]) || []);
    setLoading(false);
  };

  return (
    <MainLayout>
      <Header title="الدعم" subtitle="افتح تذكرة جديدة أو تابع تذاكرك السابقة" />

      <div className="md:p-6 space-y-5" dir="rtl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-muted-foreground">
            {tickets.length > 0 ? `${tickets.length} تذكرة` : "لا توجد تذاكر بعد"}
          </div>
          <Button onClick={() => setCreateOpen(true)} className="h-10 rounded-full gap-2">
            <Plus className="h-4 w-4" />
            تذكرة جديدة
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
        ) : tickets.length === 0 ? (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="p-10 text-center">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <LifeBuoy className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-1">لا توجد تذاكر بعد</h3>
              <p className="text-sm text-muted-foreground mb-4">
                هل واجهت مشكلة أو لديك استفسار؟ افتح تذكرة وسنتواصل معك قريباً.
              </p>
              <Button onClick={() => setCreateOpen(true)} className="h-10 rounded-full gap-2">
                <Plus className="h-4 w-4" />
                افتح تذكرتك الأولى
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => (
              <Card
                key={t.id}
                onClick={() => navigate(`/support/${t.id}`)}
                className="rounded-2xl cursor-pointer hover:shadow-md hover:border-primary/30 transition-all"
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground ltr-nums">{t.ticket_number}</span>
                      <Badge variant="outline" className={cn("text-[10px] font-medium", STATUS_TONE[t.status])}>
                        {STATUS_LABEL[t.status]}
                      </Badge>
                    </div>
                    <div className="font-semibold truncate mt-0.5">{t.subject}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 ltr-nums">
                      آخر تحديث: {format(new Date(t.updated_at), "dd/MM/yyyy HH:mm")}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground rotate-180 shrink-0" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          setCreateOpen(false);
          navigate(`/support/${id}`);
        }}
      />
    </MainLayout>
  );
}

// ─────────────────────────────────────────────────────────────────
// CREATE DIALOG
// ─────────────────────────────────────────────────────────────────
function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (ticketId: string) => void;
}) {
  const { user } = useAuth();
  const { agentId } = useAgentContext();
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("support_categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => setCategories((data as Category[]) || []));
    // Reset form whenever the dialog re-opens.
    setCategoryId("");
    setSubcategoryId("");
    setSubject("");
    setBody("");
    setFiles([]);
  }, [open]);

  const topCategories = useMemo(() => categories.filter((c) => c.parent_id === null), [categories]);
  const subcategories = useMemo(
    () => categories.filter((c) => c.parent_id === categoryId),
    [categories, categoryId],
  );

  const submit = async () => {
    if (!user || !agentId) {
      toast.error("لا يمكن إنشاء التذكرة بدون سياق وكيل");
      return;
    }
    if (!categoryId) {
      toast.error("اختر فئة المشكلة");
      return;
    }
    if (!subject.trim() || !body.trim()) {
      toast.error("الموضوع والوصف مطلوبان");
      return;
    }

    setSubmitting(true);
    try {
      // 1. Insert ticket
      const { data: ticketData, error: tErr } = await supabase
        .from("support_tickets")
        .insert({
          agent_id: agentId,
          category_id: categoryId,
          subcategory_id: subcategoryId || null,
          subject: subject.trim(),
          created_by_user_id: user.id,
        })
        .select("id")
        .single();
      if (tErr || !ticketData) throw tErr || new Error("ticket insert failed");

      // 2. Insert first message
      const { data: msgData, error: mErr } = await supabase
        .from("support_messages")
        .insert({
          ticket_id: ticketData.id,
          author_user_id: user.id,
          body: body.trim(),
        })
        .select("id")
        .single();
      if (mErr || !msgData) throw mErr || new Error("message insert failed");

      // 3. Upload + register attachments. Each file lives at
      //    {ticket_id}/{message_id}/{uuid-name} so storage RLS can
      //    extract ticket_id from the path.
      for (const f of files) {
        const safe = f.name.replace(/[^A-Za-z0-9._-]/g, "_");
        const path = `${ticketData.id}/${msgData.id}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from("support-attachments")
          .upload(path, f, { contentType: f.type });
        if (upErr) {
          console.error("upload failed", upErr);
          continue;
        }
        await supabase.from("support_attachments").insert({
          message_id: msgData.id,
          file_path: path,
          file_name: f.name,
          file_size: f.size,
          mime_type: f.type || null,
        });
      }

      // 4. Notify Thiqa support via SMTP (fire-and-forget; the user
      //    shouldn't wait on email delivery to see their ticket).
      supabase.functions.invoke("support-notify", {
        body: { ticket_id: ticketData.id, event: "ticket_created" },
      }).catch(() => {});

      toast.success("تم إنشاء التذكرة");
      onCreated(ticketData.id);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "تعذّر إنشاء التذكرة");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>تذكرة دعم جديدة</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">الفئة</label>
            <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setSubcategoryId(""); }}>
              <SelectTrigger><SelectValue placeholder="اختر فئة..." /></SelectTrigger>
              <SelectContent>
                {topCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-right">{c.name_ar}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {subcategories.length > 0 && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">الفئة الفرعية</label>
              <Select value={subcategoryId} onValueChange={setSubcategoryId}>
                <SelectTrigger><SelectValue placeholder="اختر فئة فرعية (اختياري)..." /></SelectTrigger>
                <SelectContent>
                  {subcategories.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-right">{c.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1.5 block">الموضوع</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="ملخص قصير للمشكلة..." />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">الوصف</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="اشرح ما يحدث، الخطوات للوصول إليه، والنتيجة المتوقعة..."
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">المرفقات (اختياري)</label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const incoming = Array.from(e.target.files || []);
                setFiles((prev) => [...prev, ...incoming]);
                if (e.target) e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="gap-2"
            >
              <Paperclip className="h-4 w-4" />
              إضافة ملفات (صور / فيديو)
            </Button>
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-muted/40 rounded-md px-2 py-1">
                    <FileIcon mime={f.type} />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-muted-foreground ltr-nums">{(f.size / 1024).toFixed(0)} KB</span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="إزالة"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>إلغاء</Button>
          <Button onClick={submit} disabled={submitting} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            إرسال
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────
// THREAD VIEW
// ─────────────────────────────────────────────────────────────────
function TicketThread({ ticketId }: { ticketId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isSuperAdmin } = useAuth();
  const fromAdmin = location.pathname.startsWith("/thiqa");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachmentsByMessage, setAttachmentsByMessage] = useState<Record<string, Attachment[]>>({});
  const [signedUrlsByPath, setSignedUrlsByPath] = useState<Record<string, string>>({});
  const [authorsByUserId, setAuthorsByUserId] = useState<Record<string, AuthorProfile>>({});
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchAll();
    // Realtime — append new messages live so admin replies show up
    // without a page reload. Filter to this ticket only so we don't
    // wake up for unrelated tickets.
    const channel = supabase
      .channel(`support_messages_${ticketId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: `ticket_id=eq.${ticketId}` },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [ticketId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const fetchAll = async () => {
    setLoading(true);
    const [tRes, mRes] = await Promise.all([
      supabase.from("support_tickets").select("*").eq("id", ticketId).maybeSingle(),
      supabase.from("support_messages").select("*").eq("ticket_id", ticketId).order("created_at", { ascending: true }),
    ]);
    if (tRes.data) setTicket(tRes.data as Ticket);
    const msgs = (mRes.data as Message[]) || [];
    setMessages(msgs);

    if (msgs.length > 0) {
      const ids = msgs.map((m) => m.id);
      // Fetch profiles for each unique author so the thread shows real
      // names instead of the generic "زميل" fallback.
      const authorIds = Array.from(new Set(msgs.map((m) => m.author_user_id)));
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", authorIds)
        .then(({ data: profs }) => {
          const m: Record<string, AuthorProfile> = {};
          ((profs as any[]) || []).forEach((p) => {
            m[p.id] = { full_name: p.full_name || null, email: p.email || null };
          });
          setAuthorsByUserId(m);
        });

      const { data: atts } = await supabase
        .from("support_attachments")
        .select("*")
        .in("message_id", ids);
      const map: Record<string, Attachment[]> = {};
      (atts as Attachment[] || []).forEach((a) => {
        (map[a.message_id] = map[a.message_id] || []).push(a);
      });
      setAttachmentsByMessage(map);
      // Sign every attachment up-front so thumbnails resolve without
      // a per-render round-trip. 60-minute TTL is plenty for a reading
      // session; refresh on mount handles stale links.
      const allAtts = (atts as Attachment[]) || [];
      if (allAtts.length > 0) {
        const paths = allAtts.map((a) => a.file_path);
        const { data: signed } = await supabase.storage
          .from("support-attachments")
          .createSignedUrls(paths, 60 * 60);
        const sm: Record<string, string> = {};
        (signed || []).forEach((s, i) => {
          if (s.signedUrl) sm[paths[i]] = s.signedUrl;
        });
        setSignedUrlsByPath(sm);
      }
    }
    setLoading(false);
  };

  const sendReply = async () => {
    if (!user || !ticket) return;
    if (!reply.trim() && files.length === 0) {
      toast.error("اكتب ردك أو أضف ملفاً");
      return;
    }
    setSending(true);
    try {
      const { data: msgData, error: mErr } = await supabase
        .from("support_messages")
        .insert({
          ticket_id: ticket.id,
          author_user_id: user.id,
          body: reply.trim() || "(مرفقات)",
        })
        .select("id")
        .single();
      if (mErr || !msgData) throw mErr || new Error("send failed");

      for (const f of files) {
        const safe = f.name.replace(/[^A-Za-z0-9._-]/g, "_");
        const path = `${ticket.id}/${msgData.id}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from("support-attachments")
          .upload(path, f, { contentType: f.type });
        if (upErr) { console.error(upErr); continue; }
        await supabase.from("support_attachments").insert({
          message_id: msgData.id,
          file_path: path,
          file_name: f.name,
          file_size: f.size,
          mime_type: f.type || null,
        });
      }

      supabase.functions.invoke("support-notify", {
        body: { ticket_id: ticket.id, message_id: msgData.id, event: "message_added" },
      }).catch(() => {});

      setReply("");
      setFiles([]);
      // Realtime will push the message back; refetch attachments for it.
      fetchAll();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "تعذّر إرسال الرد");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="p-6 space-y-3">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }
  if (!ticket) {
    return (
      <MainLayout>
        <div className="p-8 text-center text-muted-foreground">التذكرة غير موجودة</div>
      </MainLayout>
    );
  }

  const closed = ticket.status === "done" || ticket.status === "cancelled";

  const updateStatus = async (newStatus: Ticket["status"]) => {
    if (!ticket) return;
    const { error } = await supabase
      .from("support_tickets")
      .update({ status: newStatus })
      .eq("id", ticket.id);
    if (error) {
      toast.error("تعذّر تحديث الحالة");
      return;
    }
    setTicket({ ...ticket, status: newStatus });
    // Notify the requester via SMTP that their ticket moved.
    supabase.functions.invoke("support-notify", {
      body: { ticket_id: ticket.id, event: "status_changed", new_status: newStatus },
    }).catch(() => {});
    toast.success("تم تحديث الحالة");
  };

  // Back target follows the route the user is actually on. Super-admins
  // open tickets via /thiqa/support/:id (admin path) — they go back to
  // the global inbox. Agent-side users use /support/:id and go back to
  // their own list.
  const backTarget = fromAdmin ? "/thiqa/support" : "/support";

  return (
    <MainLayout>
      <Header title={`تذكرة ${ticket.ticket_number}`} subtitle={ticket.subject} />

      <div className="md:p-6 space-y-4 max-w-4xl mx-auto" dir="rtl">
        {/* Header card — back, ticket meta, status changer in one block. */}
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-4 flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(backTarget)}
              className="shrink-0 h-9 w-9"
              aria-label="رجوع"
            >
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-mono text-xs text-muted-foreground ltr-nums">{ticket.ticket_number}</span>
                <Badge variant="outline" className={cn("font-medium", STATUS_TONE[ticket.status])}>
                  {STATUS_LABEL[ticket.status]}
                </Badge>
              </div>
              <div className="font-semibold text-base md:text-lg text-foreground leading-snug">{ticket.subject}</div>
            </div>
            {isSuperAdmin && (
              <div className="shrink-0">
                <Select value={ticket.status} onValueChange={(v) => updateStatus(v as Ticket["status"])}>
                  <SelectTrigger className="h-9 w-[170px] gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">{STATUS_LABEL.open}</SelectItem>
                    <SelectItem value="in_progress">{STATUS_LABEL.in_progress}</SelectItem>
                    <SelectItem value="done">{STATUS_LABEL.done}</SelectItem>
                    <SelectItem value="cancelled">{STATUS_LABEL.cancelled}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Thread */}
        <Card className="rounded-2xl shadow-sm overflow-hidden">
          <CardContent className="p-4 md:p-6 space-y-5 max-h-[62vh] overflow-y-auto bg-muted/20">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <MessageCircle className="h-10 w-10 opacity-30 mb-2" />
                <span className="text-sm">لا توجد رسائل بعد</span>
              </div>
            ) : (
              messages.map((m, idx) => {
                const mine = m.author_user_id === user?.id;
                const adminSide = m.is_admin_reply;
                const author = authorsByUserId[m.author_user_id];
                const senderName = adminSide
                  ? "فريق ثقة"
                  : mine
                    ? "أنت"
                    : (author?.full_name || author?.email || "زميل");
                const prev = idx > 0 ? messages[idx - 1] : null;
                const showDateSep = !prev || !isSameDay(new Date(prev.created_at), new Date(m.created_at));
                const initials = adminSide ? "" : getInitials(senderName);
                const atts = attachmentsByMessage[m.id] || [];
                return (
                  <Fragment key={m.id}>
                    {showDateSep && (
                      <div className="flex justify-center my-1">
                        <span className="text-[11px] font-medium text-muted-foreground bg-background border rounded-full px-3 py-1 shadow-sm">
                          {format(new Date(m.created_at), "EEEE، d MMMM yyyy", { locale: ar })}
                        </span>
                      </div>
                    )}
                    <div className={cn("flex gap-2.5 items-end", adminSide ? "flex-row" : "flex-row-reverse")}>
                      {/* Avatar */}
                      <div
                        className={cn(
                          "h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 shadow-sm",
                          adminSide
                            ? "bg-primary text-primary-foreground"
                            : mine
                              ? "bg-foreground text-background"
                              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                        )}
                        title={senderName}
                      >
                        {adminSide ? <ShieldCheck className="h-4 w-4" /> : initials}
                      </div>

                      {/* Sender meta + bubble */}
                      <div className={cn("max-w-[78%] flex flex-col gap-1", adminSide ? "items-start" : "items-end")}>
                        <div className="flex items-center gap-2 px-1">
                          <span className="text-xs font-semibold text-foreground/85">{senderName}</span>
                          <span className="text-[10px] text-muted-foreground ltr-nums">
                            {format(new Date(m.created_at), "HH:mm")}
                          </span>
                        </div>
                        <div
                          className={cn(
                            "rounded-2xl px-4 py-2.5 shadow-sm border",
                            adminSide
                              ? "bg-primary/8 border-primary/20 rounded-tr-sm"
                              : mine
                                ? "bg-foreground text-background border-foreground/10 rounded-tl-sm"
                                : "bg-background border-border rounded-tl-sm",
                          )}
                        >
                          <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</div>
                          {atts.length > 0 && (
                            <div
                              className={cn(
                                "mt-2.5 grid gap-2",
                                atts.length === 1 ? "grid-cols-1 max-w-[280px]" : "grid-cols-2 max-w-[420px]",
                              )}
                            >
                              {atts.map((a) => (
                                <AttachmentTile key={a.id} attachment={a} url={signedUrlsByPath[a.file_path]} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Fragment>
                );
              })
            )}
            <div ref={bottomRef} />
          </CardContent>
        </Card>

        {closed && !isSuperAdmin ? (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="p-4 text-sm text-muted-foreground text-center">
              هذه التذكرة {STATUS_LABEL[ticket.status]}. افتح تذكرة جديدة إذا احتجت لمزيد من المساعدة.
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-3 md:p-4 space-y-3">
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                placeholder="اكتب ردك..."
                className="resize-none border-0 focus-visible:ring-0 p-2 text-sm"
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  setFiles((prev) => [...prev, ...Array.from(e.target.files || [])]);
                  if (e.target) e.target.value = "";
                }}
              />
              {files.length > 0 && (
                <div className="space-y-1">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs bg-muted/40 rounded-md px-2 py-1.5">
                      <FileIcon mime={f.type} />
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="text-muted-foreground ltr-nums">{(f.size / 1024).toFixed(0)} KB</span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="إزالة"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-2 text-muted-foreground hover:text-foreground"
                >
                  <Paperclip className="h-4 w-4" />
                  مرفقات
                </Button>
                <Button onClick={sendReply} disabled={sending} className="gap-2 rounded-full px-5">
                  {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {!sending && <Send className="h-4 w-4" />}
                  إرسال
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
function FileIcon({ mime }: { mime: string }) {
  if (mime.startsWith("image/")) return <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />;
  if (mime.startsWith("video/")) return <Video className="h-3.5 w-3.5 text-muted-foreground" />;
  return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
}

function AttachmentTile({ attachment, url }: { attachment: Attachment; url: string | undefined }) {
  const isImage = (attachment.mime_type || "").startsWith("image/");
  const isVideo = (attachment.mime_type || "").startsWith("video/");
  if (!url) {
    return (
      <div className="rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground">
        {attachment.file_name}
      </div>
    );
  }
  if (isImage) {
    // object-contain keeps small images at their natural size instead
    // of stretching a tiny icon to fill 200px tall — the original
    // object-cover crop made screenshots look broken.
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg overflow-hidden border bg-muted/30 hover:border-primary/40 transition-colors"
        title={attachment.file_name}
      >
        <img src={url} alt={attachment.file_name} className="w-full max-h-48 object-contain" />
      </a>
    );
  }
  if (isVideo) {
    return (
      <video controls src={url} className="w-full max-h-48 rounded-lg border bg-black" />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 text-xs hover:bg-muted hover:border-primary/40 transition-colors"
    >
      <FileText className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 truncate">{attachment.file_name}</span>
      <Download className="h-3.5 w-3.5 text-muted-foreground" />
    </a>
  );
}
