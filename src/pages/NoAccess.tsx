import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldX, Mail, Phone, LogOut, Loader2, Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { NoIndex } from "@/components/seo/NoIndex";

interface AgentContact {
  agent_name: string | null;
  email: string | null;
  phone: string | null;
}

export default function NoAccess() {
  const { user, profile, signOut, loading, isActive } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  // Contact info comes from the locked user's OWN agency (agents.email
  // / phone), not from Thiqa platform admins. The lockout reason is
  // always something the agent owner has to fix (upgrade plan, free a
  // user seat) so showing them platform support emails just sent the
  // worker bouncing.
  const [agentContact, setAgentContact] = useState<AgentContact | null>(null);

  useEffect(() => {
    supabase.rpc("get_my_agent_admin_contact").then(({ data }) => {
      if (data && data.length > 0) {
        const row = data[0] as AgentContact;
        setAgentContact(row);
      }
    });
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login', { replace: true });
    }
    if (!loading && user && isActive) {
      navigate('/', { replace: true });
    }
  }, [user, loading, isActive, navigate]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    navigate('/login', { replace: true });
  };

  if (loading) {
    return (
      <>
        <NoIndex />
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    );
  }

  const isPlanLocked = profile?.status === 'plan_locked';

  return (
    <>
    <NoIndex />
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border shadow-lg animate-scale-in">
        <CardHeader className="text-center space-y-4">
          {/* Icon */}
          <div
            className={
              isPlanLocked
                ? "mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/30"
                : "mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 border border-destructive/20"
            }
          >
            {isPlanLocked ? (
              <Lock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            ) : (
              <ShieldX className="h-8 w-8 text-destructive" />
            )}
          </div>
          <div>
            <CardTitle className="text-2xl font-bold text-foreground">
              {isPlanLocked ? "حسابك مقفل مؤقتاً" : "لا تملك صلاحية الدخول"}
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-2">
              {isPlanLocked
                ? "تم تجاوز عدد المستخدمين المسموح في باقة وكالتك"
                : "حسابك بانتظار موافقة المدير"}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="rounded-lg bg-secondary/50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">تم تسجيل الدخول بـ:</span>
            </div>
            <p className="font-medium text-foreground"><bdi>{user?.email || profile?.email || "..."}</bdi></p>
          </div>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              {isPlanLocked
                ? "يحتاج المدير إلى ترقية باقة الوكالة أو إضافة مستخدمين إضافيين لفتح حسابك."
                : "يحتاج المدير إلى الموافقة على طلب دخولك قبل أن تتمكن من استخدام النظام."}
            </p>
            <p className="text-sm text-muted-foreground text-center">
              {isPlanLocked
                ? "للتواصل مع مدير الوكالة:"
                : "إذا كنت تعتقد أن هذا خطأ، يرجى التواصل مع:"}
            </p>
            {agentContact?.email || agentContact?.phone ? (
              <div className="rounded-lg border bg-secondary/40 p-3 space-y-2">
                {agentContact.agent_name && (
                  <p className="text-sm font-semibold text-foreground text-center">
                    <bdi>{agentContact.agent_name}</bdi>
                  </p>
                )}
                {agentContact.email && (
                  <a
                    href={`mailto:${agentContact.email}`}
                    className="flex items-center justify-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    <Mail className="h-4 w-4" />
                    <bdi>{agentContact.email}</bdi>
                  </a>
                )}
                {agentContact.phone && (
                  <a
                    href={`tel:${agentContact.phone}`}
                    className="flex items-center justify-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    <Phone className="h-4 w-4" />
                    <bdi dir="ltr">{agentContact.phone}</bdi>
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm font-medium text-primary text-center">
                <bdi>الدعم الفني</bdi>
              </p>
            )}
          </div>

          <Button 
            variant="outline" 
            className="w-full gap-2"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            {signingOut ? "جاري تسجيل الخروج..." : "تسجيل الخروج"}
          </Button>
        </CardContent>
      </Card>
    </div>
    </>
  );
}
