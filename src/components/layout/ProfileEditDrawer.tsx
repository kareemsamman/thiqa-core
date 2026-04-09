import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
import { User, Phone, Mail, Save, Loader2, Lock, Eye, EyeOff, ChevronDown, ChevronUp } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface ProfileEditDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileEditDrawer({ open, onOpenChange }: ProfileEditDrawerProps) {
  const { user, profile, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [phone, setPhone] = useState((profile as any)?.phone || "");

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
          <p className="text-xs text-muted-foreground">{profile?.email}</p>
        </div>

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
        </div>
      </SheetContent>
    </Sheet>
  );
}
