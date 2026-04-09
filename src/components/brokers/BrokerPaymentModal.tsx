import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface BrokerPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brokerId: string;
  amount: number;
  direction: 'we_owe' | 'broker_owes';
  settlementDate: string;
  notes?: string;
  onSuccess: () => void;
  onFailure: () => void;
}

type PaymentStatus = 'initializing' | 'iframe' | 'polling' | 'success' | 'failed' | 'test_success';

export function BrokerPaymentModal({
  open,
  onOpenChange,
  brokerId,
  amount,
  direction,
  settlementDate,
  notes,
  onSuccess,
  onFailure,
}: BrokerPaymentModalProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<PaymentStatus>('initializing');
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [formFields, setFormFields] = useState<Record<string, string> | null>(null);
  const [settlementId, setSettlementId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [formSubmitted, setFormSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      initializePayment();
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setStatus('initializing');
      setIframeUrl(null);
      setFormFields(null);
      setSettlementId(null);
      setErrorMessage(null);
      setFormSubmitted(false);
    }
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [open]);

  useEffect(() => {
    if (status === 'iframe' && formRef.current && !formSubmitted && formFields) {
      const timer = setTimeout(() => {
        if (formRef.current) {
          formRef.current.submit();
          setFormSubmitted(true);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [status, formFields, formSubmitted]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'BROKER_PAYMENT_RESULT') {
        const { status: paymentStatus, error_message, error_code } = event.data;
        
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }

        if (paymentStatus === 'success') {
          setStatus('success');
          toast({
            title: "تم الدفع بنجاح",
            description: "تم تسجيل الدفعة للوسيط",
          });
          setTimeout(() => {
            onSuccess();
            onOpenChange(false);
          }, 1500);
        } else if (paymentStatus === 'failed') {
          setStatus('failed');
          // Use detailed error message from Tranzila if available
          if (error_message && error_message.trim()) {
            setErrorMessage(error_message);
          } else if (error_code) {
            setErrorMessage(`فشلت عملية الدفع (كود الخطأ: ${error_code})`);
          } else {
            setErrorMessage('فشلت عملية الدفع');
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess, onOpenChange, toast]);

  const initializePayment = async () => {
    try {
      setStatus('initializing');
      setErrorMessage(null);
      setFormSubmitted(false);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await supabase.functions.invoke('tranzila-broker-init', {
        body: {
          broker_id: brokerId,
          amount,
          direction,
          settlement_date: settlementDate,
          notes,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to initialize payment');
      }

      const data = response.data;
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to initialize payment');
      }

      setSettlementId(data.settlement_id);

      if (data.test_mode) {
        setStatus('test_success');
        toast({
          title: "وضع الاختبار",
          description: "تم محاكاة الدفع بنجاح (وضع التجربة)",
        });
        setTimeout(() => {
          onSuccess();
          onOpenChange(false);
        }, 2000);
        return;
      }

      setIframeUrl(data.iframe_url);
      setFormFields(data.form_fields);
      setStatus('iframe');

      startStatusPolling(data.settlement_id);

    } catch (error) {
      console.error('Error initializing broker payment:', error);
      setErrorMessage(error instanceof Error ? error.message : 'فشل في تهيئة الدفع');
      setStatus('failed');
    }
  };

  const startStatusPolling = (setId: string) => {
    pollingRef.current = setInterval(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const statusUrl = `https://${projectId}.supabase.co/functions/v1/tranzila-broker-status?settlement_id=${setId}`;
        
        const res = await fetch(statusUrl, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });

        if (!res.ok) return;

        const statusData = await res.json();

        if (statusData.status === 'paid') {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setStatus('success');
          toast({
            title: "تم الدفع بنجاح",
            description: `رقم التأكيد: ${statusData.approval_code || 'N/A'}`,
          });
          setTimeout(() => {
            onSuccess();
            onOpenChange(false);
          }, 2000);
        } else if (statusData.status === 'failed') {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setStatus('failed');
          setErrorMessage('فشلت عملية الدفع');
        }
      } catch (error) {
        console.error('Error polling broker status:', error);
      }
    }, 3000);
  };

  const handleRetry = () => {
    initializePayment();
  };

  const handleCancel = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    
    onFailure();
    onOpenChange(false);
  };

  const formatCurrency = (val: number) => `₪${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  return (
    <Dialog open={open} onOpenChange={(val) => !val && handleCancel()}>
      <DialogContent 
        className="sm:max-w-2xl max-h-[90vh]" 
        dir="rtl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            دفع بالبطاقة الائتمانية - الوسيط
          </DialogTitle>
          <DialogDescription>
            المبلغ: {formatCurrency(amount)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[400px] flex flex-col">
          {status === 'initializing' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">جاري تهيئة الدفع...</p>
            </div>
          )}

          {status === 'iframe' && iframeUrl && formFields && (
            <div className="flex-1 flex flex-col">
              <form
                ref={formRef}
                action={iframeUrl}
                method="POST"
                target="broker-tranzila-iframe"
                style={{ display: 'none' }}
              >
                {Object.entries(formFields).map(([key, value]) => (
                  <input key={key} type="hidden" name={key} value={value} />
                ))}
              </form>

              <div className="flex-1 border rounded-lg overflow-hidden bg-background">
                <iframe
                  name="broker-tranzila-iframe"
                  className="w-full h-full min-h-[400px]"
                  title="Tranzila Payment"
                  // @ts-ignore
                  allowpaymentrequest="true"
                />
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">
                أدخل بيانات البطاقة في النموذج أعلاه
              </p>
            </div>
          )}

          {status === 'polling' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">جاري التحقق من الدفع...</p>
            </div>
          )}

          {(status === 'success' || status === 'test_success') && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="w-20 h-20 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle className="h-12 w-12 text-success" />
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-success">تمت عملية الدفع بنجاح!</p>
                {status === 'test_success' && (
                  <p className="text-sm text-amber-600 mt-1">(وضع الاختبار - محاكاة)</p>
                )}
              </div>
            </div>
          )}

          {status === 'failed' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="h-12 w-12 text-destructive" />
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-destructive">فشلت عملية الدفع</p>
                {errorMessage && (
                  <p className="text-sm text-muted-foreground mt-1">{errorMessage}</p>
                )}
              </div>
              <div className="flex gap-2 mt-4">
                <Button variant="outline" onClick={handleCancel}>
                  إلغاء
                </Button>
                <Button onClick={handleRetry}>
                  إعادة المحاولة
                </Button>
              </div>
            </div>
          )}
        </div>

        {status === 'iframe' && (
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleCancel}>
              إلغاء
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
