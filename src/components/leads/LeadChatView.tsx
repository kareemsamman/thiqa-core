import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { RefreshCw, Bot, User, Phone, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface LeadMessage {
  id: string;
  lead_id: string;
  phone: string;
  message_type: "ai" | "human";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface LeadChatViewProps {
  leadId: string;
  phone: string;
  onSyncComplete?: (requiresCallback: boolean) => void;
}

export function LeadChatView({ leadId, phone, onSyncComplete }: LeadChatViewProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isFirstLoad, setIsFirstLoad] = useState(true);

  // Fetch messages from Supabase
  const { data: messages, isLoading } = useQuery({
    queryKey: ["lead-messages", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_messages")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as LeadMessage[];
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sync-whatsapp-chat", {
        body: { phone, lead_id: leadId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["lead-messages", leadId] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      
      if (data.requiresCallback) {
        toast({
          title: "🔔 طلب اتصال!",
          description: "العميل أكد رغبته بالاتصال، يرجى التواصل معه",
          variant: "default",
        });
        onSyncComplete?.(true);
      } else {
        toast({ title: `تم مزامنة ${data.synced} رسالة` });
        onSyncComplete?.(false);
      }
    },
    onError: (error) => {
      toast({
        title: "فشل المزامنة",
        description: error instanceof Error ? error.message : "خطأ غير معروف",
        variant: "destructive",
      });
    },
  });

  // Auto-sync on first load
  useEffect(() => {
    if (isFirstLoad && phone) {
      syncMutation.mutate();
      setIsFirstLoad(false);
    }
  }, [phone, isFirstLoad]);

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel(`lead-messages-${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lead_messages",
          filter: `lead_id=eq.${leadId}`,
        },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ["lead-messages", leadId] });
          
          // Check if new message indicates callback request
          const newMsg = payload.new as LeadMessage;
          if (newMsg.message_type === "ai" && newMsg.content.includes("تم تسجيل طلبك")) {
            toast({
              title: "🔔 طلب اتصال جديد!",
              description: "العميل أكد رغبته بالاتصال",
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leadId, queryClient]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (isLoading && !messages) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#e5ddd5] dark:bg-[#0b141a] relative">
      {/* WhatsApp-style background pattern */}
      <div
        className="absolute inset-0 opacity-5 dark:opacity-10 pointer-events-none z-0"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* Chat Messages - Scrollable */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative z-10">
        <div className="p-3 space-y-2">
          {messages && messages.length > 0 ? (
            messages.map((msg, index) => (
              <div
                key={msg.id}
                className={cn(
                  "flex",
                  msg.message_type === "human" ? "justify-start" : "justify-end"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-3 py-2 shadow-sm relative",
                    msg.message_type === "human"
                      ? "bg-white dark:bg-[#202c33] rounded-tl-none"
                      : "bg-[#dcf8c6] dark:bg-[#005c4b] rounded-tr-none"
                  )}
                >
                  {/* Message type indicator */}
                  <div
                    className={cn(
                      "flex items-center gap-1 text-[10px] mb-1 font-medium",
                      msg.message_type === "human"
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-green-700 dark:text-green-400"
                    )}
                  >
                    {msg.message_type === "human" ? (
                      <>
                        <User className="h-3 w-3" />
                        <span>العميل</span>
                      </>
                    ) : (
                      <>
                        <Bot className="h-3 w-3" />
                        <span>Bot</span>
                      </>
                    )}
                  </div>

                  {/* Content */}
                  <p
                    className={cn(
                      "text-sm whitespace-pre-wrap break-words",
                      msg.message_type === "human"
                        ? "text-gray-900 dark:text-gray-100"
                        : "text-gray-900 dark:text-gray-100"
                    )}
                  >
                    {msg.content}
                  </p>

                  {/* Highlight callback request */}
                  {msg.message_type === "ai" &&
                    msg.content.includes("تم تسجيل طلبك") && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 px-2 py-1 rounded">
                        <Phone className="h-3 w-3" />
                        <span>⚠️ طلب اتصال!</span>
                      </div>
                    )}

                  {/* Time */}
                  <p
                    className={cn(
                      "text-[10px] text-right mt-1",
                      msg.message_type === "human"
                        ? "text-gray-500 dark:text-gray-400"
                        : "text-green-800/70 dark:text-green-400/70"
                    )}
                  >
                    {format(new Date(msg.created_at), "p", { locale: ar })}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <MessageCircle className="h-8 w-8 opacity-50" />
              </div>
              <p className="text-sm font-medium">لا توجد رسائل</p>
              <p className="text-xs">اضغط مزامنة لجلب المحادثة من WhatsApp</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom sync bar */}
      <div className="p-2 bg-background/90 backdrop-blur border-t flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MessageCircle className="h-3 w-3" />
          <span>{messages?.length || 0} رسالة</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="h-7 text-xs gap-1"
        >
          <RefreshCw
            className={cn("h-3 w-3", syncMutation.isPending && "animate-spin")}
          />
          {syncMutation.isPending ? "جاري المزامنة..." : "مزامنة"}
        </Button>
      </div>
    </div>
  );
}
