import { Badge } from '@/components/ui/badge';
import { NotificationMetadata, getPaymentTypeLabels } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';
import { Tag } from 'lucide-react';

interface PaymentTypeBadgesProps {
  metadata?: NotificationMetadata | null;
  className?: string;
  showIcon?: boolean;
}

// Color classes for different payment types
const PAYMENT_TYPE_COLORS: Record<string, string> = {
  'قسط': 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  'تجديد': 'bg-teal-500/10 text-teal-600 border-teal-500/20',
  'تسوية شركة': 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  'عمولة': 'bg-pink-500/10 text-pink-600 border-pink-500/20',
  'تسديد دين': 'bg-red-500/10 text-red-600 border-red-500/20',
  'استرجاع': 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  'قسط (دفعة)': 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
  'دفعة أخرى': 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  'دفعة': 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

export function PaymentTypeBadges({ metadata, className, showIcon = false }: PaymentTypeBadgesProps) {
  const typeLabels = getPaymentTypeLabels(metadata ?? null);
  
  if (!typeLabels || typeLabels.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {typeLabels.map((label, index) => {
        const colorClass = PAYMENT_TYPE_COLORS[label] || PAYMENT_TYPE_COLORS['دفعة'];
        
        return (
          <Badge 
            key={`${label}-${index}`}
            variant="outline" 
            className={cn(
              "gap-1 font-normal text-xs",
              colorClass
            )}
          >
            {showIcon && <Tag className="h-2.5 w-2.5" />}
            <span>{label}</span>
          </Badge>
        );
      })}
    </div>
  );
}
