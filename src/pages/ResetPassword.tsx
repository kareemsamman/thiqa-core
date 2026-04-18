import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import thiqaLogoDark from "@/assets/thiqa-logo-dark.svg";
import loginBgMobile from "@/assets/login-bg-mobile.png";
import { checkPasswordStrength, isPasswordValid } from "@/lib/authValidation";
import { PublicSEO } from "@/components/public/PublicSEO";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [samePasswordError, setSamePasswordError] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setSessionReady(true);
      }
    });

    // Check if we're already in a recovery session from hash
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setSessionReady(true);
    }

    // Also check existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async () => {
    if (!isPasswordValid(password)) {
      toast.error("كلمة المرور يجب أن تحتوي على 8 أحرف، حرف كبير، رقم، ورمز");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("كلمة المرور غير متطابقة");
      return;
    }

    setLoading(true);
    setSamePasswordError(false);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        if (error.message?.toLowerCase().includes("same") || error.message?.toLowerCase().includes("different") || error.message?.toLowerCase().includes("should be different")) {
          setSamePasswordError(true);
          toast.error("لا يمكنك استخدام نفس كلمة المرور السابقة، اختر كلمة مرور جديدة");
          return;
        }
        throw error;
      }
      setSuccess(true);
      toast.success("تم تغيير كلمة المرور بنجاح");
      setTimeout(() => navigate("/login", { replace: true }), 2000);
    } catch (e: any) {
      const msg = e.message || "";
      if (msg.toLowerCase().includes("same") || msg.toLowerCase().includes("previous") || msg.toLowerCase().includes("different")) {
        setSamePasswordError(true);
        toast.error("لا يمكنك استخدام نفس كلمة المرور السابقة، اختر كلمة مرور جديدة");
      } else {
        toast.error(msg || "حدث خطأ في تغيير كلمة المرور");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative" dir="rtl">
      <PublicSEO
        title="Thiqa | تعيين كلمة مرور جديدة"
        description="أعد تعيين كلمة المرور لحسابك في Thiqa بأمان."
      />
      <div className="fixed inset-0 lg:hidden -z-10">
        <img src={loginBgMobile} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/30 backdrop-blur-md" />
      </div>
      <div className="hidden lg:block fixed inset-0 -z-10 bg-gradient-to-br from-muted/40 to-background" />

      <div className="w-full max-w-md animate-scale-in">
        <div className="rounded-3xl border border-white/20 bg-white/95 dark:bg-card/95 lg:bg-white/70 lg:dark:bg-card/70 backdrop-blur-xl shadow-2xl shadow-black/10 overflow-hidden">
          <div className="text-center pt-8 pb-4 px-5 sm:px-8">
            <img src={thiqaLogoDark} alt="ثقة" className="mx-auto h-10 w-auto object-contain mb-2" />
            <h1 className="text-2xl font-bold text-foreground">تعيين كلمة مرور جديدة</h1>
            <p className="text-muted-foreground mt-1 text-sm">أدخل كلمة المرور الجديدة</p>
          </div>

          <div className="px-5 sm:px-8 pb-8 space-y-4">
            {!sessionReady ? (
              <div className="text-center space-y-3 py-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                <p className="text-sm text-muted-foreground">جاري التحقق من الجلسة...</p>
              </div>
            ) : success ? (
              <div className="text-center space-y-3 py-4">
                <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto" />
                <p className="font-medium text-green-700">تم تغيير كلمة المرور بنجاح!</p>
                <p className="text-sm text-muted-foreground">جاري التحويل لصفحة تسجيل الدخول...</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>كلمة المرور الجديدة</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setSamePasswordError(false); }}
                      placeholder="8 أحرف، حرف كبير، رقم، ورمز"
                      className="h-11 rounded-xl pl-10"
                      dir="ltr"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {samePasswordError && (
                    <p className="text-xs text-destructive">لا يمكنك استخدام نفس كلمة المرور السابقة</p>
                  )}

                  {/* Password strength indicator */}
                  {password.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <div className="flex gap-1">
                        {[0, 1, 2, 3].map((i) => {
                          const strength = checkPasswordStrength(password);
                          return (
                            <div
                              key={i}
                              className={`h-1 flex-1 rounded-full transition-colors ${
                                i < strength.score ? strength.color : "bg-border"
                              }`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                        {(() => {
                          const { checks } = checkPasswordStrength(password);
                          return (
                            <>
                              <span className={checks.minLength ? "text-green-600" : "text-muted-foreground"}>
                                8+ أحرف {checks.minLength ? "✓" : ""}
                              </span>
                              <span className={checks.hasUpper ? "text-green-600" : "text-muted-foreground"}>
                                حرف كبير {checks.hasUpper ? "✓" : ""}
                              </span>
                              <span className={checks.hasNumber ? "text-green-600" : "text-muted-foreground"}>
                                رقم {checks.hasNumber ? "✓" : ""}
                              </span>
                              <span className={checks.hasSymbol ? "text-green-600" : "text-muted-foreground"}>
                                رمز {checks.hasSymbol ? "✓" : ""}
                              </span>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>تأكيد كلمة المرور</Label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="أعد إدخال كلمة المرور"
                      className="h-11 rounded-xl pl-10"
                      dir="ltr"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-xs text-destructive">كلمة المرور غير متطابقة</p>
                  )}
                </div>
                <Button
                  className="w-full h-12 text-base rounded-xl shadow-lg"
                  onClick={handleReset}
                  disabled={loading || !isPasswordValid(password) || password !== confirmPassword}
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin ml-2" /> : null}
                  {loading ? "جاري التحديث..." : "تحديث كلمة المرور"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
