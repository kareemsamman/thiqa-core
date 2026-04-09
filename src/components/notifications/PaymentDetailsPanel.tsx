import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  NotificationMetadata, 
  getPaymentDetails, 
  getPaymentMethod,
  getPaymentTypeLabels,
  PAYMENT_METHOD_LABELS 
} from '@/hooks/useNotifications';
import { PaymentMethodBadge } from './PaymentMethodBadge';
import { PaymentTypeBadges } from './PaymentTypeBadges';
import { 
  User, 
  FileText, 
  Wallet, 
  ExternalLink,
  Calendar,
  Hash,
  Receipt
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaymentDetailsPanelProps {
  metadata: NotificationMetadata | null;
  className?: string;
}

export function PaymentDetailsPanel({ metadata, className }: PaymentDetailsPanelProps) {
  const navigate = useNavigate();
  const details = getPaymentDetails(metadata);
  const method = getPaymentMethod(metadata);
  const typeLabels = getPaymentTypeLabels(metadata);
  
  if (!details && !method) return null;

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  return (
    <div className={cn("space-y-4", className)}>
      <h4 className="font-medium text-sm flex items-center gap-2">
        <Wallet className="h-4 w-4 text-primary" />
        تفاصيل الدفعة
      </h4>
      
      <div className="space-y-3 text-sm">
        {/* Payment Method */}
        {method && (
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">طريقة الدفع:</span>
            <PaymentMethodBadge method={method} />
          </div>
        )}
        
        {/* Payment Type(s) */}
        {typeLabels && typeLabels.length > 0 && (
          <div className="flex justify-between items-start">
            <span className="text-muted-foreground">نوع الدفعة:</span>
            <PaymentTypeBadges metadata={metadata} />
          </div>
        )}
        
        {/* Amount */}
        {details?.amount && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">المبلغ:</span>
            <span className="font-semibold ltr-nums text-primary">
              ₪{details.amount.toLocaleString()}
            </span>
          </div>
        )}
        
        {/* Client Name */}
        {details?.client_name && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">العميل:</span>
            <span className="font-medium">{details.client_name}</span>
          </div>
        )}
        
        {/* Reference */}
        {details?.reference && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">رقم المرجع:</span>
            <span className="ltr-nums font-mono text-xs bg-muted px-2 py-0.5 rounded">
              {details.reference}
            </span>
          </div>
        )}
        
        {/* Cheque Details */}
        {details?.cheque && (method === 'cheque') && (
          <>
            <Separator className="my-2" />
            <div className="space-y-2 bg-amber-500/5 p-3 rounded-lg border border-amber-500/20">
              <h5 className="text-xs font-medium text-amber-700 flex items-center gap-1">
                <Receipt className="h-3 w-3" />
                تفاصيل الشيك
              </h5>
              {details.cheque.number && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">رقم الشيك:</span>
                  <span className="ltr-nums font-mono">{details.cheque.number}</span>
                </div>
              )}
              {details.cheque.due_date && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">تاريخ الاستحقاق:</span>
                  <span className="ltr-nums">{details.cheque.due_date}</span>
                </div>
              )}
              {details.cheque.bank_name && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">البنك:</span>
                  <span>{details.cheque.bank_name}</span>
                </div>
              )}
            </div>
          </>
        )}
        
        {/* Installment Details */}
        {details?.installment && (
          <>
            <Separator className="my-2" />
            <div className="flex justify-between items-center bg-cyan-500/5 p-3 rounded-lg border border-cyan-500/20">
              <span className="text-xs text-cyan-700 flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                رقم القسط:
              </span>
              <Badge variant="secondary" className="ltr-nums">
                {details.installment.index} من {details.installment.total}
              </Badge>
            </div>
          </>
        )}
        
        {/* Notes */}
        {details?.notes && (
          <div className="mt-2 p-2 bg-muted/50 rounded text-xs text-muted-foreground">
            {details.notes}
          </div>
        )}
      </div>
      
      {/* Quick Links */}
      {(details?.client_id || details?.policy_id || details?.payment_id) && (
        <>
          <Separator />
          <div className="space-y-2">
            <h5 className="text-xs text-muted-foreground font-medium">روابط سريعة</h5>
            <div className="flex flex-wrap gap-2">
              {details?.client_id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => handleNavigate(`/clients/${details.client_id}`)}
                >
                  <User className="h-3 w-3" />
                  فتح العميل
                  <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                </Button>
              )}
              {details?.policy_id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => handleNavigate(`/policies?id=${details.policy_id}`)}
                >
                  <FileText className="h-3 w-3" />
                  فتح الوثيقة
                  <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                </Button>
              )}
              {details?.payment_id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => handleNavigate(`/cheques?id=${details.payment_id}`)}
                >
                  <Wallet className="h-3 w-3" />
                  فتح الدفعة
                  <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
