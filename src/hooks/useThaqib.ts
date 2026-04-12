import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ChatSession {
  id: string;
  title: string | null;
  updated_at: string;
}

export function useThaqib() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const { data, error } = await supabase
        .from("ai_chat_sessions" as any)
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false })
        .limit(30);
      if (error) console.error("[useThaqib] fetchSessions error:", error);
      setSessions((data as unknown as ChatSession[]) || []);
    } catch (e) { console.error("[useThaqib] fetchSessions:", e); }
    finally { setLoadingSessions(false); }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setSessionId(id);
    sessionIdRef.current = id;
    try {
      const { data } = await supabase
        .from("ai_chat_messages" as any)
        .select("id, role, content, created_at")
        .eq("session_id", id)
        .order("created_at", { ascending: true });
      setMessages((data as unknown as ChatMessage[]) || []);
    } catch { /* silent */ }
  }, []);

  const startNewSession = useCallback(() => {
    setSessionId(null);
    sessionIdRef.current = null;
    setMessages([]);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const currentSessionId = sessionIdRef.current;
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: { message: text, session_id: currentSessionId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Save session ID for continuity
      if (data?.session_id && !currentSessionId) {
        setSessionId(data.session_id);
        sessionIdRef.current = data.session_id;
      }

      const assistantMsg: ChatMessage = {
        id: `resp-${Date.now()}`,
        role: "assistant",
        content: data?.reply || "عذراً، لم أتمكن من الرد.",
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Refresh sessions list so history updates
      fetchSessions();

      return data?.reply;
    } catch (e: any) {
      const content = await extractFunctionErrorMessage(e);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: content || "حدث خطأ. يرجى المحاولة مرة أخرى.",
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [fetchSessions]);

  return {
    sessionId,
    messages,
    sessions,
    loading,
    loadingSessions,
    sendMessage,
    fetchSessions,
    loadSession,
    startNewSession,
  };
}
