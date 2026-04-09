import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Package, MoreVertical, Send, Eye, Loader2 } from 'lucide-react';
import { PolicyRecord, PaymentStatus, getPolicyStatus } from './types';
import { useAuth } from '@/hooks/useAuth';

interface PolicyCardHeaderProps {
  mainPolicy: PolicyRecord;
  paymentStatus: PaymentStatus;
  isPackage: boolean;
  sendingPolicy: string | null;
  onSendInvoice: (e: React.MouseEvent, policyId: string) => void;
  onPolicyClick: (policyId: string) => void;
  onEditPolicy: (policy: PolicyRecord) => void;
  onDeletePolicy: (policy: PolicyRecord) => void;
}

export function PolicyCardHeader({
  mainPolicy,
  paymentStatus,
  isPackage,
  sendingPolicy,
  onSendInvoice,
  onPolicyClick,
  onEditPolicy,
  onDeletePolicy,
}: PolicyCardHeaderProps) {
  const { isAdmin } = useAuth();
  const status = getPolicyStatus(mainPolicy);

  return (
    <div className="flex items-center justify-between">
      {/* Right: Status Chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={status.variant}>{status.label}</Badge>
        
        {paymentStatus.isPaid ? (
          <Badge variant="success">مدفوع</Badge>
        ) : (
          <Badge variant="destructive">غير مدفوع</Badge>
        )}
        
        {isPackage && (
          <Badge variant="outline" className="bg-primary/5 border-primary/20 text-primary gap-1">
            <Package className="h-3 w-3" />
            باقة
          </Badge>
        )}
      </div>

      {/* Left: Actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={sendingPolicy === mainPolicy.id}
          onClick={(e) => onSendInvoice(e, mainPolicy.id)}
        >
          {sendingPolicy === mainPolicy.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onPolicyClick(mainPolicy.id)}>
              <Eye className="h-4 w-4 ml-2" />
              عرض التفاصيل
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEditPolicy(mainPolicy)}>
              تعديل
            </DropdownMenuItem>
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => onDeletePolicy(mainPolicy)}
                >
                  حذف
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
