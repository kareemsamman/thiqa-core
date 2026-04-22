import { Checkbox } from '@/components/ui/checkbox';
import { PERMISSION_GROUPS } from '@/hooks/usePermissions';
import { cn } from '@/lib/utils';

interface PermissionMatrixProps {
  value: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Reusable permission-matrix editor used by:
 *   - UserPermissionsDialog (per-user override on profiles.permissions)
 *   - DefaultEmployeePermissionsEditor (agent-level template on
 *     agents.default_employee_permissions)
 *
 * Renders every key in PERMISSION_GROUPS grouped by label with a
 * "select all" toggle per group. Unchecked == omitted from the stored
 * JSON (preserves fall-through to agent defaults for the dialog case).
 */
export function PermissionMatrix({ value, onChange, className, disabled }: PermissionMatrixProps) {
  const toggle = (key: string, checked: boolean) => {
    const next = { ...value };
    if (checked) next[key] = true;
    else next[key] = false;
    onChange(next);
  };

  const setGroup = (keys: readonly string[], checked: boolean) => {
    const next = { ...value };
    keys.forEach((k) => {
      next[k] = checked;
    });
    onChange(next);
  };

  return (
    <div className={cn('space-y-6', className)}>
      {PERMISSION_GROUPS.map((group) => {
        const keys: string[] = group.keys.map((pair) => pair[0]);
        const allOn = keys.every((k) => value[k] === true);
        const anyOn = keys.some((k) => value[k] === true);

        return (
          <div key={group.label} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-3 pb-2 border-b">
              <h3 className="font-semibold text-sm">{group.label}</h3>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`group-${group.label}`}
                  checked={allOn ? true : anyOn ? 'indeterminate' : false}
                  onCheckedChange={(checked) => setGroup(keys, !!checked)}
                  disabled={disabled}
                />
                <label
                  htmlFor={`group-${group.label}`}
                  className="text-xs text-muted-foreground cursor-pointer"
                >
                  تحديد الكل
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {group.keys.map(([key, label]) => (
                <label
                  key={key}
                  className={cn(
                    'flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors',
                    'hover:bg-muted/50',
                    disabled && 'pointer-events-none opacity-60',
                  )}
                >
                  <Checkbox
                    checked={value[key] === true}
                    onCheckedChange={(checked) => toggle(key, !!checked)}
                    disabled={disabled}
                  />
                  <span className="text-sm flex-1">{label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
