import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowRight, LifeBuoy, Loader2, Paperclip, Plus, Send, X, Image as ImageIcon, Video, FileText, Download } from "lucide-react";
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
import { supabase as supabaseTyped } from "@/integrations/supabase/client";

// Alias to `any` so the new support_* tables are reachable before
// supabase types are regenerated. Once `supabase gen types` has been
// run after applying migration 20260428150000, this can collapse back
// to a plain re-export.
const supabase = supabaseTyped as any;
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
  const { user } = useAuth();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachmentsByMessage, setAttachmentsByMessage] = useState<Record<string, Attachment[]>>({});
  const [signedUrlsByPath, setSignedUrlsByPath] = useState<Record<string, string>>({});
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

  return (
    <MainLayout>
      <Header title={`تذكرة ${ticket.ticket_number}`} subtitle={ticket.subject} />

      <div className="md:p-6 space-y-4" dir="rtl">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => navigate("/support")} className="gap-1.5">
            <ArrowRight className="h-4 w-4" />
            رجوع لقائمة التذاكر
          </Button>
          <Badge variant="outline" className={cn("font-medium", STATUS_TONE[ticket.status])}>
            {STATUS_LABEL[ticket.status]}
          </Badge>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-4 md:p-5 space-y-4 max-h-[60vh] overflow-y-auto">
            {messages.map((m) => {
              const mine = m.author_user_id === user?.id;
              const adminSide = m.is_admin_reply;
              return (
                <div key={m.id} className={cn("flex", adminSide ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-3 shadow-sm",
                      adminSide
                        ? "bg-primary/5 border border-primary/20"
                        : mine
                          ? "bg-foreground text-background"
                          : "bg-muted/60",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
                        {adminSide ? "فريق ثقة" : mine ? "أنت" : "زميل"}
                      </span>
                      <span className="text-[10px] opacity-60 ltr-nums">
                        {format(new Date(m.created_at), "dd/MM HH:mm")}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</div>
                    {(attachmentsByMessage[m.id] || []).length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {(attachmentsByMessage[m.id] || []).map((a) => (
                          <AttachmentTile key={a.id} attachment={a} url={signedUrlsByPath[a.file_path]} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </CardContent>
        </Card>

        {closed ? (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="p-4 text-sm text-muted-foreground text-center">
              هذه التذكرة {STATUS_LABEL[ticket.status]}. افتح تذكرة جديدة إذا احتجت لمزيد من المساعدة.
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-4 space-y-3">
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                placeholder="اكتب ردك..."
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
                    <div key={i} className="flex items-center gap-2 text-xs bg-muted/40 rounded-md px-2 py-1">
                      <FileIcon mime={f.type} />
                      <span className="flex-1 truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-2">
                  <Paperclip className="h-4 w-4" />
                  مرفقات
                </Button>
                <Button onClick={sendReply} disabled={sending} className="gap-2">
                  {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Send className="h-4 w-4" />
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
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border bg-background">
        <img src={url} alt={attachment.file_name} className="w-full h-32 object-cover" />
      </a>
    );
  }
  if (isVideo) {
    return (
      <video controls src={url} className="w-full h-32 object-cover rounded-lg border bg-black" />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 text-xs hover:bg-muted"
    >
      <FileText className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 truncate">{attachment.file_name}</span>
      <Download className="h-3.5 w-3.5 text-muted-foreground" />
    </a>
  );
}
