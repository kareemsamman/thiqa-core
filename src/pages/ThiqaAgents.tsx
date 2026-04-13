import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Building2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { arDZ as ar } from "date-fns/locale";

interface Agent {
  id: string;
  name: string;
  name_ar: string | null;
  email: string;
  phone: string | null;
  plan: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  monthly_price: number | null;
  created_at: string;
  email_confirmed?: boolean;
}

export default function ThiqaAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (!error && data) {
      // Fetch email_confirmed status for each agent's primary user
      const agentIds = data.map((a: any) => a.id);
      const { data: auData } = await supabase
        .from('agent_users')
        .select('agent_id, user_id, profiles!agent_users_user_id_profiles_fkey(email_confirmed)')
        .in('agent_id', agentIds);

      const confirmMap: Record<string, boolean> = {};
      (auData || []).forEach((au: any) => {
        const confirmed = au.profiles?.email_confirmed === true;
        // If any user is confirmed, mark agent as confirmed
        if (confirmed || !(au.agent_id in confirmMap)) {
          confirmMap[au.agent_id] = confirmed || (confirmMap[au.agent_id] ?? false);
        }
      });

      setAgents((data as Agent[]).map(a => ({ ...a, email_confirmed: confirmMap[a.id] ?? false })));
    }
    setLoading(false);
  };

  const filteredAgents = agents.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.email.toLowerCase().includes(search.toLowerCase()) ||
    (a.name_ar && a.name_ar.includes(search))
  );

  const statusBadge = (agent: Agent) => {
    if (!agent.email_confirmed) {
      return <Badge variant="outline" className="border-amber-500 text-amber-600">غير مفعّل</Badge>;
    }
    switch (agent.subscription_status) {
      case 'active': return <Badge className="bg-green-600">فعال</Badge>;
      case 'suspended': return <Badge variant="destructive">معلّق</Badge>;
      case 'expired': return <Badge variant="secondary">منتهي</Badge>;
      default: return <Badge variant="outline">{agent.subscription_status}</Badge>;
    }
  };

  const planBadge = (plan: string) => {
    switch (plan) {
      case 'pro': return <Badge className="bg-primary">Pro</Badge>;
      case 'basic': return <Badge variant="outline">Basic</Badge>;
      default: return <Badge variant="outline">{plan}</Badge>;
    }
  };

  return (
    <MainLayout>
      <div className="space-y-4 md:space-y-6" dir="rtl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">إدارة الوكلاء</h1>
            <p className="text-xs md:text-sm text-muted-foreground">إدارة وكلاء التأمين المشتركين في منصة ثقة</p>
          </div>
          <Button onClick={() => navigate('/thiqa/agents/new')} size="sm" className="w-full sm:w-auto">
            <Plus className="h-4 w-4 ml-2" />
            وكيل جديد
          </Button>
        </div>

        <div className="relative max-w-full sm:max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="بحث بالاسم أو الإيميل..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pr-10"
          />
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (
          <>
            {/* Mobile cards view */}
            <div className="md:hidden space-y-3">
              {filteredAgents.map(agent => (
                <div 
                  key={agent.id}
                  className="glass-card p-4 rounded-xl cursor-pointer active:scale-[0.98] transition-transform"
                  onClick={() => navigate(`/thiqa/agents/${agent.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{agent.name_ar || agent.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{agent.email}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                       {statusBadge(agent)}
                      {planBadge(agent.plan)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs text-muted-foreground">
                    <span>انتهاء: {agent.subscription_expires_at ? format(new Date(agent.subscription_expires_at), 'dd/MM/yyyy') : '—'}</span>
                    <span className="font-medium text-foreground">{agent.monthly_price ? `₪${agent.monthly_price}` : '—'}</span>
                  </div>
                </div>
              ))}
              {filteredAgents.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm">لا يوجد وكلاء</div>
              )}
            </div>

            {/* Desktop table view */}
            <div className="border rounded-lg overflow-hidden hidden md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-right p-3 font-medium">الوكيل</th>
                    <th className="text-right p-3 font-medium">الإيميل</th>
                    <th className="text-right p-3 font-medium">الخطة</th>
                    <th className="text-right p-3 font-medium">الحالة</th>
                    <th className="text-right p-3 font-medium">انتهاء الاشتراك</th>
                    <th className="text-right p-3 font-medium">السعر</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map(agent => (
                    <tr 
                      key={agent.id} 
                      className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => navigate(`/thiqa/agents/${agent.id}`)}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Building2 className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <div className="font-medium">{agent.name_ar || agent.name}</div>
                            {agent.phone && <div className="text-xs text-muted-foreground">{agent.phone}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">{agent.email}</td>
                      <td className="p-3">{planBadge(agent.plan)}</td>
                      <td className="p-3">{statusBadge(agent)}</td>
                      <td className="p-3 text-muted-foreground">
                        {agent.subscription_expires_at 
                          ? format(new Date(agent.subscription_expires_at), 'dd/MM/yyyy')
                          : '—'}
                      </td>
                      <td className="p-3 font-medium">{agent.monthly_price ? `₪${agent.monthly_price}` : '—'}</td>
                    </tr>
                  ))}
                  {filteredAgents.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        لا يوجد وكلاء
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}
