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

interface TranzilaPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string;
  amount: number;
  paymentDate: string;
  notes?: string;
  onSuccess: () => void;
  onFailure: () => void;
}

type PaymentStatus = 'initializing' | 'iframe' | 'polling' | 'success' | 'failed' | 'test_success';

export function TranzilaPaymentModal({
  open,
  onOpenChange,
  policyId,
  amount,
  paymentDate,
  notes,
  onSuccess,
  onFailure,
}: TranzilaPaymentModalProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<PaymentStatus>('initializing');
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [formFields, setFormFields] = useState<Record<string, string> | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [formSubmitted, setFormSubmitted] = useState(false);

  // Initialize payment when modal opens
  useEffect(() => {
    if (open) {
      initializePayment();
    } else {
      // Cleanup on close
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setStatus('initializing');
      setIframeUrl(null);
      setFormFields(null);
      setPaymentId(null);
      setErrorMessage(null);
      setFormSubmitted(false);
    }
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [open]);

  // Submit form to iframe after it's rendered
  useEffect(() => {
    if (status === 'iframe' && formRef.current && !formSubmitted && formFields) {
      // Small delay to ensure iframe is ready
      const timer = setTimeout(() => {
        if (formRef.current) {
          formRef.current.submit();
          setFormSubmitted(true);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [status, formFields, formSubmitted]);

  // Listen for postMessage from payment success/fail pages loaded in iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Check if message is from our payment pages
      if (event.data?.type === 'TRANZILA_PAYMENT_RESULT') {
        const { status: paymentStatus, error_message, error_code } = event.data;
        
        // Clear polling since we got direct result
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }

        if (paymentStatus === 'success') {
          setStatus('success');
          toast({
            title: "تم الدفع بنجاح",
            description: "تم استلام الدفع بنجاح",
          });
          // Fast close - user already saw success in iframe with countdown
          setTimeout(() => {
            onSuccess();
            onOpenChange(false);
          }, 500);
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

      const response = await supabase.functions.invoke('tranzila-init', {
        body: {
          policy_id: policyId,
          amount,
          payment_date: paymentDate,
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

      setPaymentId(data.payment_id);

      // Check if test mode
      if (data.test_mode) {
        setStatus('test_success');
        toast({
          title: "وضع الاختبار",
          description: "تم محاكاة الدفع بنجاح (وضع التجربة)",
        });
        // Auto-close after showing success
        setTimeout(() => {
          onSuccess();
          onOpenChange(false);
        }, 2000);
        return;
      }

      // Real payment - set iframe URL and form fields for POST
      setIframeUrl(data.iframe_url);
      setFormFields(data.form_fields);
      setStatus('iframe');

      // Start polling for payment status
      startStatusPolling(data.payment_id);

    } catch (error) {
      console.error('Error initializing payment:', error);
      setErrorMessage(error instanceof Error ? error.message : 'فشل في تهيئة الدفع');
      setStatus('failed');
    }
  };

  const startStatusPolling = (pmtId: string) => {
    // Poll every 3 seconds
    pollingRef.current = setInterval(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const statusUrl = `https://${projectId}.supabase.co/functions/v1/tranzila-status?payment_id=${pmtId}`;
        
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
            description: `رقم المعاملة: ${statusData.transaction_id || 'N/A'}`,
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
        console.error('Error polling status:', error);
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
            دفع بالبطاقة الائتمانية
          </DialogTitle>
          <DialogDescription>
            المبلغ: {formatCurrency(amount)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[400px] flex flex-col">
          {/* Initializing */}
          {status === 'initializing' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">جاري تهيئة الدفع...</p>
            </div>
          )}

          {/* Iframe for real payment - using POST method */}
          {status === 'iframe' && iframeUrl && formFields && (
            <div className="flex-1 flex flex-col">
              {(() => {
                let embedded = false;
                try {
                  embedded = window.self !== window.top;
                } catch {
                  embedded = true;
                }

                if (!embedded) return null;

                return (
                  <div className="mb-3 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    ملاحظة: بوابات الدفع (3DS) قد لا تعمل داخل نافذة المعاينة لأنها تعمل داخل iframe.
                    جرّب فتح النظام في تبويب جديد ثم أعد المحاولة.
                    <div className="mt-2 flex justify-end">
                      <Button asChild variant="outline" size="sm">
                        <a href={window.location.href} target="_blank" rel="noreferrer">
                          فتح في تبويب جديد
                        </a>
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {/* Hidden form that POSTs to the iframe (Tranzila recommended method) */}
              <form
                ref={formRef}
                action={iframeUrl}
                method="POST"
                target="tranzila-iframe"
                style={{ display: 'none' }}
              >
                {Object.entries(formFields).map(([key, value]) => (
                  <input key={key} type="hidden" name={key} value={value} />
                ))}
              </form>

              <div className="flex-1 border rounded-lg overflow-hidden bg-background">
                <iframe
                  ref={iframeRef}
                  name="tranzila-iframe"
                  className="w-full h-full min-h-[400px]"
                  title="Tranzila Payment"
                  // Per Tranzila docs: allowpaymentrequest='true'
                  // @ts-ignore - allowpaymentrequest is valid but not in types
                  allowpaymentrequest="true"
                />
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">
                أدخل بيانات البطاقة في النموذج أعلاه
              </p>
            </div>
          )}

          {/* Polling */}
          {status === 'polling' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-muted-foreground">جاري التحقق من الدفع...</p>
            </div>
          )}

          {/* Success */}
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

          {/* Failed */}
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

        {/* Footer actions for iframe state */}
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
