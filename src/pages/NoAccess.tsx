import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldX, Mail, LogOut, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export default function NoAccess() {
  const { user, profile, signOut, loading, isActive } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [adminEmails, setAdminEmails] = useState<string[]>([]);

  useEffect(() => {
    supabase.from("thiqa_super_admins").select("email").then(({ data }) => {
      if (data) setAdminEmails(data.map((r) => r.email).filter((e) => e.includes("@")));
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border shadow-lg animate-scale-in">
        <CardHeader className="text-center space-y-4">
          {/* Icon */}
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 border border-destructive/20">
            <ShieldX className="h-8 w-8 text-destructive" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold text-foreground">
              لا تملك صلاحية الدخول
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-2">
              حسابك بانتظار موافقة المدير
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
              يحتاج المدير إلى الموافقة على طلب دخولك قبل أن تتمكن من استخدام النظام.
            </p>
            <p className="text-sm text-muted-foreground text-center">
              إذا كنت تعتقد أن هذا خطأ، يرجى التواصل مع:
            </p>
            {adminEmails.length > 0 ? (
              adminEmails.map((e) => (
                <p key={e} className="text-sm font-medium text-primary text-center">
                  <bdi>{e}</bdi>
                </p>
              ))
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
  );
}
