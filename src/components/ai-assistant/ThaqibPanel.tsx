import { useEffect, useRef, useState } from "react";
import { X, Bot, Plus, History, Loader2, MessageSquare, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useThaqib } from "@/hooks/useThaqib";
import { ThaqibMessage } from "./ThaqibMessage";
import { ThaqibInput } from "./ThaqibInput";

interface ThaqibPanelProps {
  open: boolean;
  onClose: () => void;
}

// Panel has two views: the live chat and a full history list that
// takes over the whole panel when the user opens it. Staff asked
// for a proper dedicated view instead of the old cramped dropdown.
type PanelView = "chat" | "history";

const formatRelative = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "الآن";
  if (diff < hour) return `منذ ${Math.floor(diff / minute)} دقيقة`;
  if (diff < day) return `منذ ${Math.floor(diff / hour)} ساعة`;
  if (diff < 7 * day) return `منذ ${Math.floor(diff / day)} يوم`;
  return d.toLocaleDateString("en-GB");
};

export function ThaqibPanel({ open, onClose }: ThaqibPanelProps) {
  const {
    messages, sessions, loading, loadingSessions,
    sendMessage, fetchSessions, loadSession, startNewSession,
  } = useThaqib();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PanelView>("chat");

  useEffect(() => {
    if (open) fetchSessions();
  }, [open]);

  useEffect(() => {
    // Reset to the chat view every time the panel opens — a fresh
    // open shouldn't leave you staring at the history list.
    if (open) setView("chat");
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!open) return null;

  const handleOpenHistory = () => {
    fetchSessions();
    setView("history");
  };

  const handlePickSession = async (id: string) => {
    await loadSession(id);
    setView("chat");
  };

  const handleNewChat = () => {
    startNewSession();
    setView("chat");
  };

  return (
    <div
      className={cn(
        "fixed z-[55] bottom-4 left-4 w-[380px] max-w-[calc(100vw-2rem)]",
        "h-[550px] max-h-[calc(100vh-6rem)]",
        "rounded-2xl border shadow-2xl overflow-hidden",
        "bg-background flex flex-col",
        "animate-in slide-in-from-bottom-4 fade-in duration-300"
      )}
      dir="rtl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ background: '#122143' }}>
        <div className="flex items-center gap-2">
          {view === "history" ? (
            <button
              onClick={() => setView("chat")}
              className="h-8 w-8 rounded-lg bg-white/10 hover:bg-white/15 flex items-center justify-center text-white transition-colors"
              aria-label="الرجوع للمحادثة"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center">
              <Bot className="h-4 w-4 text-white" />
            </div>
          )}
          <div>
            <h3 className="text-sm font-bold text-white">
              {view === "history" ? "سجل المحادثات" : "ثاقب"}
            </h3>
            <p className="text-[10px] text-white/60">
              {view === "history"
                ? `${sessions.length} محادثة`
                : "المساعد الذكي"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Open history view (only shown on chat view) */}
          {view === "chat" && (
            <button
              onClick={handleOpenHistory}
              className="h-7 w-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
              title="سجل المحادثات"
              aria-label="سجل المحادثات"
            >
              <History className="h-3.5 w-3.5" />
            </button>
          )}

          {/* New chat */}
          <button
            onClick={handleNewChat}
            className="h-7 w-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
            title="محادثة جديدة"
            aria-label="محادثة جديدة"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
            title="إغلاق"
            aria-label="إغلاق"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {view === "history" ? (
        /* History view — full-panel session list with a new-chat
           card on top and one card per past session. Each card is
           clickable and opens the chat with that session loaded. */
        <div className="flex-1 overflow-y-auto px-3 py-3 bg-muted/20">
          <button
            onClick={handleNewChat}
            className="w-full mb-3 flex items-center gap-3 p-3 rounded-xl border-2 border-dashed border-primary/40 hover:border-primary hover:bg-primary/5 transition-colors text-right"
          >
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Plus className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">محادثة جديدة</p>
              <p className="text-[11px] text-muted-foreground">ابدأ من نقطة البداية</p>
            </div>
          </button>

          {loadingSessions && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {!loadingSessions && sessions.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground">
              <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                <MessageSquare className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium">لا توجد محادثات سابقة</p>
              <p className="text-xs mt-1">ابدأ محادثة جديدة لتظهر هنا</p>
            </div>
          )}

          {!loadingSessions && sessions.length > 0 && (
            <div className="space-y-2">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handlePickSession(s.id)}
                  className="w-full flex items-start gap-3 p-3 rounded-xl border bg-card hover:border-primary/50 hover:bg-accent/40 transition-colors text-right"
                >
                  <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {s.title || "محادثة بدون عنوان"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatRelative(s.updated_at)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
      <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: '#122143' }}>
              <Bot className="h-7 w-7 text-white" />
            </div>
            <h4 className="font-bold text-base mb-1">مرحباً! أنا ثاقب 👋</h4>
            <p className="text-sm text-muted-foreground mb-4">
              مساعدك الذكي في نظام ثقة. يمكنني مساعدتك بالاستعلام عن العملاء والوثائق والمدفوعات.
            </p>
            <div className="grid grid-cols-1 gap-2 w-full">
              {[
                "كم وثيقة تنتهي هذا الشهر؟",
                "أعطني معلومات العملاء",
                "ملخص المدفوعات اليوم",
              ].map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  disabled={loading}
                  className="text-xs text-right px-3 py-2 rounded-lg border hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <ThaqibMessage key={msg.id} role={msg.role} content={msg.content} />
        ))}

        {loading && (
          <div className="flex gap-2 mb-3">
            <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-1" style={{ background: '#122143' }}>
              <Bot className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ThaqibInput onSend={sendMessage} loading={loading} />
      </>
      )}
    </div>
  );
}
