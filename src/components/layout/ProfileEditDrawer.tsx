import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { User, Phone, Mail, Save, Loader2, Lock, Eye, EyeOff, ChevronDown, ChevronUp, Sparkles, ArrowLeft, ShieldCheck, AlertTriangle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface ProfileEditDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileEditDrawer({ open, onOpenChange }: ProfileEditDrawerProps) {
  const { user, profile, refreshProfile } = useAuth();
  const { agent, isThiqaSuperAdmin } = useAgentContext();
  const navigate = useNavigate();

  // Detect if user signed up with Google only (no email/password provider)
  const providers: string[] = user?.app_metadata?.providers || [];
  const isGoogleOnly = providers.includes('google') && !providers.includes('email');
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [phone, setPhone] = useState((profile as any)?.phone || "");

  // Live countdown: re-tick once a minute so the trial time stays fresh
  // while the drawer is open.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setNowTick(Date.now()), 60 * 1000);
    return () => clearInterval(interval);
  }, [open]);

  // Compact subscription summary — mirrors the Subscription page math so
  // the drawer shows the same "34 days, 2 hours" countdown as the inner
  // subscription view.
  const sub = useMemo(() => {
    if (!agent) return null;
    const status = agent.subscription_status;
    const isTrial = status === "trial" || (agent.monthly_price === 0 && status === "active");
    const trialEnd = agent.trial_ends_at
      ? new Date(agent.trial_ends_at)
      : (isTrial && agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : null);
    const expiresAt = agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : null;
    const endDate = isTrial ? trialEnd : expiresAt;
    const now = new Date(nowTick);
    const msRemaining = endDate ? Math.max(0, endDate.getTime() - now.getTime()) : 0;
    const daysRemaining = endDate ? Math.floor(msRemaining / 86400000) : null;
    const hoursRemaining = endDate ? Math.floor((msRemaining % 86400000) / 3600000) : 0;
    const minutesRemaining = endDate ? Math.floor((msRemaining % 3600000) / 60000) : 0;
    const isExpired = endDate ? endDate.getTime() <= now.getTime() : false;
    const isPaused = status === "paused" || status === "suspended";
    const isCancelled = status === "cancelled";
    const trialProgress = isTrial && daysRemaining !== null
      ? Math.min(100, Math.max(0, ((35 * 86400000 - msRemaining) / (35 * 86400000)) * 100))
      : 0;
    return {
      isTrial,
      trialEnd,
      expiresAt: endDate,
      daysRemaining,
      hoursRemaining,
      minutesRemaining,
      isExpired,
      isPaused,
      isCancelled,
      trialProgress,
    };
  }, [agent, nowTick]);

  const goToSubscription = () => {
    onOpenChange(false);
    navigate('/subscription');
  };

  // Password change
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordSectionOpen, setPasswordSectionOpen] = useState(false);

  const handleOpenChange = (val: boolean) => {
    if (val) {
      setFullName(profile?.full_name || "");
      setPhone((profile as any)?.phone || "");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSectionOpen(false);
    }
    onOpenChange(val);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          email: user.email || profile?.email || '',
          full_name: fullName.trim() || null,
          phone: phone.trim() || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (error) throw error;
      toast.success("تم تحديث الملف الشخصي");
      await refreshProfile();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Profile save error:', err);
      toast.error("خطأ: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("كلمة المرور غير متطابقة");
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("تم تغيير كلمة المرور بنجاح");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSectionOpen(false);
    } catch (err: any) {
      toast.error(err.message || "خطأ في تغيير كلمة المرور");
    } finally {
      setChangingPassword(false);
    }
  };

  const userName = profile?.full_name || profile?.email?.split("@")[0] || "";
  const initial = userName.charAt(0).toUpperCase();

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-80 sm:w-96 overflow-y-auto" dir="rtl">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-lg">الملف الشخصي</SheetTitle>
        </SheetHeader>

        {/* Avatar & Email */}
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="relative">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={userName}
                className="h-16 w-16 rounded-full object-cover ring-2 ring-primary/20"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 shadow-lg">
                <span className="text-2xl font-bold text-primary-foreground">{initial}</span>
              </div>
            )}
            {isGoogleOnly && (
              <div className="absolute -bottom-1 -left-1 h-6 w-6 rounded-full bg-white shadow-md flex items-center justify-center border border-border/40">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{profile?.email}</p>
          {isGoogleOnly && (
            <p className="text-[10px] text-muted-foreground/60">حساب مسجل عبر Google</p>
          )}
        </div>

        {/* Subscription / trial status — mirrors the inner subscription page */}
        {!isThiqaSuperAdmin && sub && agent && (
          <button
            type="button"
            onClick={goToSubscription}
            className={cn(
              "group mb-6 w-full rounded-xl border p-4 text-right transition-all hover:shadow-md overflow-hidden relative",
              sub.isTrial && !sub.isExpired
                ? "border-primary/40 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent hover:border-primary/60"
                : sub.isPaused
                  ? "border-yellow-500/40 bg-gradient-to-br from-yellow-50 to-transparent"
                  : sub.isExpired || sub.isCancelled
                    ? "border-destructive/40 bg-gradient-to-br from-destructive/10 to-transparent"
                    : "border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent"
            )}
          >
            <div className="pointer-events-none absolute -top-8 -left-8 h-24 w-24 rounded-full bg-primary/20 blur-2xl opacity-60" />

            <div className="relative flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={cn(
                  "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                  sub.isTrial ? "bg-primary/15 text-primary" :
                  sub.isPaused ? "bg-yellow-100 text-yellow-600" :
                  sub.isExpired || sub.isCancelled ? "bg-destructive/10 text-destructive" :
                  "bg-primary/15 text-primary"
                )}>
                  {sub.isTrial ? <Sparkles className="h-4 w-4" /> :
                   sub.isExpired || sub.isCancelled ? <AlertTriangle className="h-4 w-4" /> :
                   <ShieldCheck className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">
                    {sub.isTrial ? "فترة تجريبية مجانية" :
                     sub.isCancelled ? "اشتراك ملغي" :
                     `خطة ${agent.plan === "pro" ? "Pro" : agent.plan === "basic" ? "Basic" : agent.plan}`}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {sub.isTrial ? "جميع ميزات Pro متاحة" :
                     sub.isPaused ? "معلّق" :
                     sub.isExpired ? "منتهي" :
                     sub.isCancelled ? "ملغي" : "فعال"}
                  </p>
                </div>
              </div>
              <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground group-hover:-translate-x-0.5 transition-transform shrink-0" />
            </div>

            {sub.isTrial && sub.daysRemaining !== null && (
              <div className="relative space-y-1.5">
                <div className="flex items-end justify-between gap-2">
                  <p className={cn(
                    "text-sm font-bold",
                    sub.daysRemaining <= 7 ? "text-destructive" : "text-primary"
                  )}>
                    متبقي {sub.daysRemaining} يوم
                    <span className="text-[10px] font-medium text-muted-foreground mr-1">
                      {sub.hoursRemaining}س {sub.minutesRemaining}د
                    </span>
                  </p>
                  {sub.trialEnd && (
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      {format(sub.trialEnd, "dd/MM/yyyy")}
                    </p>
                  )}
                </div>
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      sub.daysRemaining <= 7 ? "bg-destructive" : "bg-primary"
                    )}
                    style={{ width: `${sub.trialProgress}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-center">
                  {Math.round(sub.trialProgress)}% منتهية · اضغط للترقية
                </p>
              </div>
            )}

            {!sub.isTrial && sub.expiresAt && !sub.isExpired && (
              <div className="relative flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">التجديد القادم</span>
                <span className="font-semibold tabular-nums">
                  {format(sub.expiresAt, "dd/MM/yyyy")}
                </span>
              </div>
            )}
          </button>
        )}

        {/* Profile Fields */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fullName" className="text-xs flex items-center gap-1.5 text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              الاسم الكامل
            </Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="أدخل اسمك"
              dir="rtl"
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs flex items-center gap-1.5 text-muted-foreground">
              <Mail className="h-3.5 w-3.5" />
              البريد الإلكتروني
            </Label>
            <Input
              id="email"
              value={profile?.email || ""}
              disabled
              className="h-9 opacity-50 cursor-not-allowed"
              dir="ltr"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-xs flex items-center gap-1.5 text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />
              رقم الهاتف
            </Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="05xxxxxxxx"
              dir="ltr"
              className="h-9"
            />
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full h-9 text-sm">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin ml-2" />
            ) : (
              <Save className="h-4 w-4 ml-2" />
            )}
            حفظ التغييرات
          </Button>

          {/* Password section — hidden for Google-only accounts */}
          {!isGoogleOnly && (
            <>
              <Separator />

              {/* Collapsible Password Section */}
              <button
                type="button"
                onClick={() => setPasswordSectionOpen(!passwordSectionOpen)}
                className="w-full flex items-center justify-between py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  تغيير كلمة المرور
                </span>
                {passwordSectionOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              <div className={cn(
                "overflow-hidden transition-all duration-200",
                passwordSectionOpen ? "max-h-[300px] opacity-100" : "max-h-0 opacity-0"
              )}>
                <div className="space-y-3 pb-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="newPassword" className="text-xs">كلمة المرور الجديدة</Label>
                    <div className="relative">
                      <Input
                        id="newPassword"
                        type={showPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="6 أحرف على الأقل"
                        dir="ltr"
                        autoComplete="new-password"
                        className="h-9 pl-9"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="confirmPassword" className="text-xs">تأكيد كلمة المرور</Label>
                    <Input
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="أعد إدخال كلمة المرور"
                      dir="ltr"
                      autoComplete="new-password"
                      className="h-9"
                    />
                  </div>

                  {newPassword && confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-xs text-destructive">كلمة المرور غير متطابقة</p>
                  )}

                  <Button
                    variant="outline"
                    onClick={handlePasswordChange}
                    disabled={changingPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword}
                    className="w-full h-9 text-sm"
                  >
                    {changingPassword ? (
                      <Loader2 className="h-4 w-4 animate-spin ml-2" />
                    ) : (
                      <Lock className="h-4 w-4 ml-2" />
                    )}
                    تغيير كلمة المرور
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
