import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { XCircle } from "lucide-react";

export default function PaymentFail() {
  const [searchParams] = useSearchParams();
  const paymentId = searchParams.get("payment_id");
  const [messageSent, setMessageSent] = useState(false);

  useEffect(() => {
    // Notify parent window (TranzilaPaymentModal) of failure
    const sendMessage = () => {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(
            { type: "TRANZILA_PAYMENT_RESULT", status: "failed", payment_id: paymentId },
            "*"
          );
          setMessageSent(true);
        }
        // Also try top window in case of nested iframes
        if (window.top && window.top !== window && window.top !== window.parent) {
          window.top.postMessage(
            { type: "TRANZILA_PAYMENT_RESULT", status: "failed", payment_id: paymentId },
            "*"
          );
        }
      } catch (e) {
        console.log('Could not post message to parent:', e);
      }
    };

    // Send immediately
    sendMessage();
    
    // Also send after short delays
    const timer1 = setTimeout(sendMessage, 100);
    const timer2 = setTimeout(sendMessage, 500);
    const timer3 = setTimeout(sendMessage, 1000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [paymentId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <div className="text-center space-y-4">
        <div className="w-20 h-20 mx-auto rounded-full bg-red-100 flex items-center justify-center">
          <XCircle className="h-12 w-12 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-red-600">فشلت عملية الدفع</h1>
        <p className="text-gray-600">حدث خطأ أثناء معالجة الدفع</p>
        {messageSent && (
          <p className="text-sm text-gray-500">سيتم إغلاق هذه النافذة تلقائياً...</p>
        )}
      </div>
    </div>
  );
}
