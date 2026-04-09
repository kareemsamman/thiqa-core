import { useState, useRef } from "react";
import { Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThaqibInputProps {
  onSend: (message: string) => void;
  loading: boolean;
}

export function ThaqibInput({ onSend, loading }: ThaqibInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setText("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-2 p-3 border-t bg-background">
      <textarea
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="اكتب رسالتك..."
        disabled={loading}
        rows={1}
        className={cn(
          "flex-1 resize-none rounded-xl border bg-muted/30 px-3 py-2.5 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30",
          "max-h-24 min-h-[40px]",
          "placeholder:text-muted-foreground/60"
        )}
        style={{ direction: "rtl" }}
      />
      <button
        onClick={handleSend}
        disabled={!text.trim() || loading}
        className={cn(
          "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-all",
          text.trim() && !loading
            ? "bg-[#122143] text-white hover:bg-[#1a3260]"
            : "bg-muted text-muted-foreground"
        )}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
    </div>
  );
}
