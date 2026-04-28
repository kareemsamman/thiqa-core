import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface AgentRow {
  id: string;
  name: string;
  name_ar: string | null;
  email: string;
  phone: string | null;
  plan: string;
  subscription_status: string;
}

interface ThiqaAgentSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Strip Arabic tatweel/diacritics + lowercase so the user can type
// loose variants and still match. Latin queries also lowercase.
function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .trim();
}

export function ThiqaAgentSearch({ open, onOpenChange }: ThiqaAgentSearchProps) {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  // Lazy-load on first open. The agents list is small (tens, not
  // thousands), so a single fetch + client-side filter is plenty.
  useEffect(() => {
    if (!open || agents.length > 0 || loading) return;
    setLoading(true);
    supabase
      .from("agents")
      .select("id, name, name_ar, email, phone, plan, subscription_status")
      .order("name", { ascending: true })
      .then(({ data }) => {
        if (data) setAgents(data as AgentRow[]);
        setLoading(false);
      });
  }, [open, agents.length, loading]);

  // Reset query when the dialog closes so reopening starts fresh.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return agents;
    return agents.filter((a) => {
      const haystack = normalize(
        [a.name, a.name_ar, a.email, a.phone].filter(Boolean).join(" "),
      );
      return haystack.includes(q);
    });
  }, [agents, query]);

  const select = (id: string) => {
    onOpenChange(false);
    navigate(`/thiqa/agents/${id}`);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="ابحث عن وكيل بالاسم أو البريد أو الهاتف..."
        value={query}
        onValueChange={setQuery}
        dir="rtl"
      />
      <CommandList>
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">جاري التحميل...</div>
        ) : (
          <>
            <CommandEmpty>لا توجد نتائج</CommandEmpty>
            <CommandGroup heading={`الوكلاء (${filtered.length})`}>
              {filtered.map((a) => (
                <CommandItem
                  key={a.id}
                  // cmdk's built-in filter would also fight our custom
                  // one — give every item a unique value so it always
                  // renders, then we control visibility via `filtered`.
                  value={a.id}
                  onSelect={() => select(a.id)}
                  className="flex items-center gap-3"
                >
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.name_ar || a.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {a.email}
                      {a.phone ? ` · ${a.phone}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {a.plan}
                    </Badge>
                    {a.subscription_status === "active" ? (
                      <Badge className="bg-green-600 text-[10px]">فعال</Badge>
                    ) : a.subscription_status === "suspended" ? (
                      <Badge variant="destructive" className="text-[10px]">معلّق</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">منتهي</Badge>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
