import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThaqibMessageProps {
  role: "user" | "assistant";
  content: string;
}

export function ThaqibMessage({ role, content }: ThaqibMessageProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex gap-2 mb-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-1",
        isUser ? "bg-primary/10 text-primary" : "bg-[#122143] text-white"
      )}>
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn(
        "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
        isUser
          ? "bg-primary text-primary-foreground rounded-br-md"
          : "bg-muted rounded-bl-md"
      )}>
        {content}
      </div>
    </div>
  );
}
