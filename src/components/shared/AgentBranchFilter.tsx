import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { useBranches } from '@/hooks/useBranches';

export interface AgentBranchFilterProps {
  /** null = "all branches" (no extra filter applied). UUID = scope to that branch. */
  value: string | null;
  onChange: (branchId: string | null) => void;
  className?: string;
  triggerClassName?: string;
}

/**
 * Page-level branch filter dropdown for global admins.
 *
 * Renders as a Select labelled with the agent's branches plus a "all
 * branches" option. The selected branch_id is meant to be threaded
 * into every data fetch on the page (RPC param or .eq('branch_id'))
 * so a global admin can scope a page to a single branch.
 *
 * Visibility:
 *   * Hidden for branch-scoped users (worker / branch admin) — their
 *     branch is fixed by RLS, no filter to expose.
 *   * Hidden when the agent has only one branch (or none yet) — there's
 *     nothing to choose between.
 *   * Hidden during auth/branch loading to avoid a flicker.
 *
 * Pages should treat `value === null` as "no extra branch filter" and
 * skip passing the parameter / clause when null. The new RPCs accept
 * an optional p_branch_id; passing null = current natural scope.
 */
export function AgentBranchFilter({
  value,
  onChange,
  className,
  triggerClassName,
}: AgentBranchFilterProps) {
  const { profile, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const { isThiqaSuperAdmin } = useAgentContext();
  const { branches, loading: branchesLoading } = useBranches();

  if (authLoading || branchesLoading) return null;

  const isGlobal =
    isThiqaSuperAdmin ||
    isSuperAdmin ||
    (isAdmin && !profile?.branch_id);
  if (!isGlobal) return null;

  // Nothing to filter against if the agent has 0 or 1 branches.
  if (!branches || branches.length < 2) return null;

  return (
    <Select
      value={value ?? 'all'}
      onValueChange={(v) => onChange(v === 'all' ? null : v)}
    >
      <SelectTrigger
        className={cn('w-44 gap-2', triggerClassName)}
        title="تصفية حسب الفرع"
      >
        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <SelectValue placeholder="جميع الفروع" />
      </SelectTrigger>
      <SelectContent className={className}>
        <SelectItem value="all" className="text-right">جميع الفروع</SelectItem>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id} className="text-right">
            {b.name_ar || b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
