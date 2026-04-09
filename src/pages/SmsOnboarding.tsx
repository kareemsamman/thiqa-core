import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  MessageSquare, Save, Loader2, Phone, ShieldCheck, AlertTriangle,
  CheckCircle2, XCircle, Send, MessageCircle, Info,
} from "lucide-react";
import { toast } from "sonner";

type VerificationStatus = "not_verified" | "pending" | "verified" | "failed";

export default function SmsOnboarding() {
  const { isAdmin } = useAuth();
  const { agent } = useAgentContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [smsSource, setSmsSource] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>("not_verified");
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("sms-verify-phone", {
          body: { action: "check_status" },
        });
        if (data?.settings) {
          const s = data.settings;
          setSmsSource(s.sms_source || agent?.phone || "");
          setIsEnabled(s.is_enabled || false);
          setHasCredentials(!!(s.sms_user && s.sms_token));
          setVerificationStatus(s.sms_verification_status || "not_verified");
          setVerificationMessage(s.sms_verification_message || null);
        } else if (agent?.phone) {
          setSmsSource(agent.phone);
        }
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, [agent]);

  const handleSaveSource = async () => {
    if (!smsSource.trim()) {
      toast.error("يرجى إدخال اسم المرسل أو رقم الهاتف");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("sms-verify-phone", {
        body: { action: "save_source", sms_source: smsSource.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("تم حفظ اسم المرسل");
    } catch (e: any) {
      toast.error(e.message || "فشل في الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setConfirmOpen(false);
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("sms-verify-phone", {
        body: { action: "start_verify" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setVerificationStatus(data.status || "pending");
      setVerificationMessage(data.message || null);

      if (data.status === "verified") {
        setIsEnabled(true);
        toast.success("تم تفعيل خدمة SMS بنجاح!");
      } else {
        toast.error(data.message || "فشل التفعيل");
      }
    } catch (e: any) {
      setVerificationStatus("failed");
      setVerificationMessage(e.message);
      toast.error(e.message || "فشل في تفعيل خدمة SMS");
    } finally {
      setVerifying(false);
    }
  };

  const isVerified = verificationStatus === "verified";

  if (!isAdmin) return null;

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto" dir="rtl">
        <div className="text-center">
          <h1 className="text-2xl font-bold flex items-center justify-center gap-2">
            <MessageSquare className="h-6 w-6 text-primary" />
            خدمة الرسائل النصية
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            إرسال إشعارات وفواتير للعملاء عبر SMS
          </p>
        </div>

        {loading ? (
          <Skeleton className="h-60 w-full" />
        ) : (
          <>
            {/* Status Card */}
            <Card className="overflow-hidden">
              <div className={cn("h-1.5 w-full", isVerified ? "bg-green-500" : "bg-muted")} />
              <CardContent className="pt-8 pb-6">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className={cn(
                    "h-16 w-16 rounded-2xl flex items-center justify-center",
                    isVerified ? "bg-green-100 text-green-600" :
                    verificationStatus === "failed" ? "bg-red-100 text-red-600" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {isVerified ? <CheckCircle2 className="h-8 w-8" /> :
                     verificationStatus === "failed" ? <AlertTriangle className="h-8 w-8" /> :
                     <MessageSquare className="h-8 w-8" />}
                  </div>

                  <div>
                    <h2 className="text-xl font-bold">
                      {isVerified ? "خدمة SMS مفعّلة" :
                       verificationStatus === "failed" ? "فشل تفعيل SMS" :
                       "خدمة SMS غير مفعّلة"}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {isVerified ? "يمكنك الآن إرسال رسائل نصية للعملاء" :
                       !hasCredentials ? "تواصل مع إدارة ثقة لإعداد خدمة SMS لحسابك" :
                       "أدخل اسم المرسل ثم اضغط تفعيل"}
                    </p>
                  </div>

                  <Badge className={cn("text-xs px-3 py-1",
                    isVerified ? "bg-green-100 text-green-700" :
                    verificationStatus === "failed" ? "bg-red-100 text-red-700" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {isVerified ? "مفعّل" : verificationStatus === "failed" ? "فشل التفعيل" : "غير مفعّل"}
                  </Badge>

                  {isVerified && (
                    <div className="flex items-center gap-2 text-green-600">
                      <ShieldCheck className="h-5 w-5" />
                      <span className="text-sm font-medium">جاهز لإرسال الرسائل</span>
                    </div>
                  )}

                  {!hasCredentials && (
                    <a href="https://wa.me/972525143581" target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="lg" className="gap-2 px-8">
                        <MessageCircle className="h-5 w-5" />
                        تواصل مع إدارة ثقة
                      </Button>
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Sender Name / Source Card */}
            {hasCredentials && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Phone className="h-5 w-5" />
                    اسم المرسل
                  </CardTitle>
                  <CardDescription>
                    الاسم أو الرقم الذي سيظهر للعملاء عند استلامهم رسالة منك
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="sms-source">اسم المرسل / رقم الهاتف</Label>
                    <Input
                      id="sms-source"
                      value={smsSource}
                      onChange={e => setSmsSource(e.target.value)}
                      placeholder="مثال: اسم شركتك أو 05XXXXXXXX"
                      dir="ltr"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button onClick={handleSaveSource} disabled={saving || !smsSource.trim()} variant="outline" className="gap-2">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      حفظ
                    </Button>

                    <Button
                      onClick={() => setConfirmOpen(true)}
                      disabled={verifying || !smsSource.trim()}
                      className="gap-2"
                    >
                      {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {verifying ? "جاري التفعيل..." : isVerified ? "إعادة التحقق" : "تفعيل SMS"}
                    </Button>
                  </div>

                  <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                    <Info className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>سيتم إرسال رسالة تجريبية للتحقق من صحة الإعدادات. بعد النجاح سيتم تفعيل الخدمة تلقائياً.</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Confirmation Dialog */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent dir="rtl" className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Send className="h-5 w-5 text-primary" />
                تفعيل خدمة SMS
              </DialogTitle>
              <DialogDescription className="text-right pt-2">
                سيتم إرسال رسالة تجريبية للتحقق من الإعدادات وتفعيل الخدمة.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>إلغاء</Button>
              <Button onClick={handleVerify} className="gap-2">
                <Send className="h-4 w-4" />
                تفعيل
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
