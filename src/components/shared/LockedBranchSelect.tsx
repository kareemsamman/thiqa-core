import { ChevronDown } from 'lucide-react';
import { Lock } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAgentContext } from '@/hooks/useAgentContext';
import { useAgentLimits } from '@/hooks/useAgentLimits';
import { useUpgradePrompt } from '@/components/pricing/UpgradePromptProvider';

export interface LockedBranchOption {
  id: string;
  name: string;
  name_ar?: string | null;
}

interface LockedBranchSelectProps {
  value: string | undefined;
  onValueChange: (value: string) => void;
  branches: LockedBranchOption[];
  placeholder?: string;
  triggerClassName?: string;
  allOption?: { value: string; label: string };
  disabled?: boolean;
}

// Branch picker that renders a locked "upgrade to unlock" trigger
// when the agent's plan limits them to a single branch. Clicking the
// locked trigger opens the branches upgrade dialog instead of the
// dropdown — same always-be-selling pattern used for the bell +
// sidebar items. Once the plan allows 2+ branches the normal Select
// renders unchanged.
export function LockedBranchSelect({
  value,
  onValueChange,
  branches,
  placeholder,
  triggerClassName,
  allOption,
  disabled,
}: LockedBranchSelectProps) {
  const { loading: contextLoading, isThiqaSuperAdmin } = useAgentContext();
  const { loading: limitsLoading, branches: branchLimit } = useAgentLimits();
  const { showUpgradePrompt } = useUpgradePrompt();

  // While plan data is still loading, render a disabled Select — no
  // lock styling, no upgrade prompt. We don't yet know whether this
  // agent is single-branch or not, so flashing the amber lock would
  // mislead any agent who's actually on a multi-branch plan. Once
  // loaded, lock only when the plan caps branches at exactly 1.
  // Thiqa super admins always pass.
  const stillLoading = contextLoading || limitsLoading;
  const locked =
    !stillLoading && !isThiqaSuperAdmin && branchLimit.effective === 1;

  if (locked) {
    const selected =
      allOption && value === allOption.value
        ? allOption.label
        : branches.find((b) => b.id === value);
    const label =
      typeof selected === 'string'
        ? selected
        : selected
          ? selected.name_ar || selected.name
          : placeholder || 'اختر الفرع';

    return (
      <button
        type="button"
        onClick={() =>
          showUpgradePrompt({
            resource: 'branches',
            current: branchLimit.used,
            limit: branchLimit.effective ?? 1,
          })
        }
        title="الفروع المتعددة — اضغط للترقية"
        className={cn(
          'relative flex h-10 w-full items-center justify-between rounded-md border border-input bg-background pr-3 pl-10 py-2 text-sm text-right text-muted-foreground cursor-pointer hover:bg-muted/40 transition-colors',
          triggerClassName,
        )}
      >
        <span className="line-clamp-1 flex items-center gap-2">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-amber-600 ring-2 ring-amber-500 shrink-0">
            <Lock className="h-2.5 w-2.5" weight="fill" />
          </span>
          <span>{label}</span>
        </span>
        <ChevronDown className="absolute left-3 h-4 w-4 opacity-50" />
      </button>
    );
  }

  return (
    <Select value={value || ''} onValueChange={onValueChange} disabled={disabled || stillLoading}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={placeholder || 'اختر الفرع'} />
      </SelectTrigger>
      <SelectContent>
        {allOption && (
          <SelectItem value={allOption.value} className="text-right">
            {allOption.label}
          </SelectItem>
        )}
        {branches.map((branch) => (
          <SelectItem key={branch.id} value={branch.id} className="text-right">
            {branch.name_ar || branch.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
