import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Enums } from '@/integrations/supabase/types';
import { policyTypeKey, policyTypeLabel } from './accountingTypes';

const TONE: Record<string, string> = {
  ELZAMI: 'bg-rose-100 text-rose-700 border-rose-200',
  THIRD: 'bg-sky-100 text-sky-700 border-sky-200',
  FULL: 'bg-violet-100 text-violet-700 border-violet-200',
  ROAD_SERVICE: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ACCIDENT_FEE_EXEMPTION: 'bg-amber-100 text-amber-700 border-amber-200',
  HEALTH: 'bg-teal-100 text-teal-700 border-teal-200',
};

interface Props {
  parent: Enums<'policy_type_parent'>;
  child: Enums<'policy_type_child'> | null;
  className?: string;
}

export function PolicyTypeBadge({ parent, child, className }: Props) {
  const key = policyTypeKey(parent, child);
  const tone = TONE[key] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <Badge variant="outline" className={cn('text-xs border', tone, className)}>
      {policyTypeLabel(parent, child)}
    </Badge>
  );
}
