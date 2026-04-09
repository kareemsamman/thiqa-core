import { useEffect, useRef } from "react";
import { X, Bot, Plus, History, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useThaqib } from "@/hooks/useThaqib";
import { ThaqibMessage } from "./ThaqibMessage";
import { ThaqibInput } from "./ThaqibInput";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ThaqibPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ThaqibPanel({ open, onClose }: ThaqibPanelProps) {
  const {
    messages, sessions, loading, loadingSessions,
    sendMessage, fetchSessions, loadSession, startNewSession,
  } = useThaqib();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) fetchSessions();
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!open) return null;

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
          <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">ثاقب</h3>
            <p className="text-[10px] text-white/60">المساعد الذكي</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Sessions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-7 w-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors">
                <History className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={startNewSession} className="gap-2">
                <Plus className="h-3.5 w-3.5" />
                محادثة جديدة
              </DropdownMenuItem>
              {loadingSessions && (
                <div className="p-2 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
              )}
              {sessions.map(s => (
                <DropdownMenuItem key={s.id} onClick={() => loadSession(s.id)} className="text-xs truncate">
                  {s.title || "محادثة"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* New chat */}
          <button
            onClick={startNewSession}
            className="h-7 w-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

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
    </div>
  );
}
