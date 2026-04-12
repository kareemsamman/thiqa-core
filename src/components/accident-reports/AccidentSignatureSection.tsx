 import { useState } from "react";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Input } from "@/components/ui/input";
 import { Label } from "@/components/ui/label";
 import { Badge } from "@/components/ui/badge";
 import { supabase } from "@/integrations/supabase/client";
 import { useToast } from "@/hooks/use-toast";
 import { extractFunctionErrorMessage } from "@/lib/functionError";
 import {
   Send,
   Loader2,
   CheckCircle,
   Phone,
   AlertCircle,
   Image as ImageIcon,
   Clock,
 } from "lucide-react";
 import { format } from "date-fns";
 import { ar } from "date-fns/locale";
 
 interface AccidentSignatureSectionProps {
   reportId: string;
   clientPhone: string | null;
   customerSignatureUrl: string | null;
   customerSignedAt: string | null;
   onSignatureUpdate: () => void;
 }
 
 export function AccidentSignatureSection({
   reportId,
   clientPhone,
   customerSignatureUrl,
   customerSignedAt,
   onSignatureUpdate,
 }: AccidentSignatureSectionProps) {
   const { toast } = useToast();
   const [sending, setSending] = useState(false);
   const [phoneOverride, setPhoneOverride] = useState("");
   const [useOverride, setUseOverride] = useState(false);
 
   const handleSendSignatureLink = async () => {
     setSending(true);
     try {
       const phoneToUse = useOverride && phoneOverride ? phoneOverride : clientPhone;
       
       if (!phoneToUse) {
         toast({
           title: "خطأ",
           description: "يرجى إدخال رقم الهاتف",
           variant: "destructive",
         });
         setSending(false);
         return;
       }
 
       const { data, error } = await supabase.functions.invoke(
         "send-accident-signature-sms",
         {
           body: {
             accident_report_id: reportId,
             phone_number_override: useOverride && phoneOverride ? phoneOverride : undefined,
           },
         }
       );
 
       if (error) throw error;
 
       if (data?.success) {
         toast({
           title: "تم الإرسال",
           description: `تم إرسال رابط التوقيع إلى ${data.sent_to}`,
         });
         onSignatureUpdate();
       } else if (data?.message) {
         toast({
           title: "تنبيه",
           description: data.message,
           variant: "default",
         });
       } else {
         throw new Error(data?.error || "فشل في إرسال الرابط");
       }
     } catch (error: any) {
       console.error("Error sending signature link:", error);
       const description = await extractFunctionErrorMessage(error);
       toast({
         title: "خطأ",
         description: description || "فشل في إرسال رابط التوقيع",
         variant: "destructive",
       });
     } finally {
       setSending(false);
     }
   };
 
   return (
     <Card>
       <CardHeader>
         <CardTitle className="text-lg flex items-center gap-2">
           ✍️ توقيع العميل
           {customerSignatureUrl && (
             <Badge variant="default" className="gap-1">
               <CheckCircle className="h-3 w-3" />
               تم التوقيع
             </Badge>
           )}
         </CardTitle>
       </CardHeader>
       <CardContent className="space-y-4">
         {customerSignatureUrl ? (
           // Signature exists - show it
           <div className="space-y-4">
             <div className="border rounded-lg p-4 bg-primary/10">
               <div className="flex items-center gap-2 mb-3 text-primary">
                 <CheckCircle className="h-5 w-5" />
                 <span className="font-medium">تم توقيع العميل على البلاغ</span>
               </div>
               {customerSignedAt && (
                 <p className="text-sm text-muted-foreground flex items-center gap-1">
                   <Clock className="h-4 w-4" />
                   بتاريخ: {format(new Date(customerSignedAt), "PPpp", { locale: ar })}
                 </p>
               )}
             </div>
             
             <div className="border rounded-lg p-4">
               <Label className="mb-2 block">صورة التوقيع:</Label>
               <div className="bg-white border rounded-lg p-2 inline-block">
                 <img
                   src={customerSignatureUrl}
                   alt="توقيع العميل"
                   className="max-h-32 w-auto"
                 />
               </div>
             </div>
           </div>
         ) : (
           // No signature - show send form
           <div className="space-y-4">
             <div className="border rounded-lg p-4 bg-muted">
               <div className="flex items-center gap-2 text-muted-foreground">
                 <AlertCircle className="h-5 w-5" />
                 <span className="font-medium">لم يتم توقيع العميل بعد</span>
               </div>
               <p className="text-sm text-muted-foreground mt-2">
                 أرسل رابط التوقيع إلى العميل عبر SMS للحصول على توقيعه الإلكتروني.
               </p>
             </div>
 
             <div className="space-y-3">
               <div className="flex items-center gap-2">
                 <input
                   type="checkbox"
                   id="useOverride"
                   checked={useOverride}
                   onChange={(e) => setUseOverride(e.target.checked)}
                   className="rounded"
                 />
                 <Label htmlFor="useOverride" className="cursor-pointer">
                   استخدام رقم هاتف مختلف
                 </Label>
               </div>
 
               {useOverride ? (
                 <div className="space-y-2">
                   <Label>رقم الهاتف البديل</Label>
                   <div className="relative">
                     <Phone className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                     <Input
                       value={phoneOverride}
                       onChange={(e) => setPhoneOverride(e.target.value)}
                       placeholder="05xxxxxxxx"
                       className="pr-10"
                       dir="ltr"
                     />
                   </div>
                 </div>
               ) : (
                 <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                   <Phone className="h-4 w-4 text-muted-foreground" />
                   <span className="text-sm">
                     سيتم الإرسال إلى: <strong dir="ltr">{clientPhone || "لا يوجد رقم"}</strong>
                   </span>
                 </div>
               )}
 
               <Button
                 onClick={handleSendSignatureLink}
                 disabled={sending || (!clientPhone && !phoneOverride)}
                 className="w-full"
               >
                 {sending ? (
                   <Loader2 className="h-4 w-4 animate-spin ml-2" />
                 ) : (
                   <Send className="h-4 w-4 ml-2" />
                 )}
                 إرسال رابط التوقيع عبر SMS
               </Button>
             </div>
           </div>
         )}
       </CardContent>
     </Card>
   );
 }