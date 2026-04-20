// Admin Shortcuts tab — lists every SHORTCUT_ACTION and lets the admin
// rebind its combo, toggle it off, or reset to the code default.

import { useMemo } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Keyboard, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { SHORTCUT_ACTIONS, type ShortcutActionKey } from '@/lib/shortcuts';
import {
  useAgentShortcuts,
  useUpdateAgentShortcut,
  useResetAgentShortcut,
} from '@/hooks/useAgentShortcuts';
import { ShortcutKeyCaptureInput } from './ShortcutKeyCaptureInput';

export function ShortcutsTabContent() {
  const { bindings, loading } = useAgentShortcuts();
  const update = useUpdateAgentShortcut();
  const reset = useResetAgentShortcut();

  // Build a combo → [actions] map so each row can flag when its combo
  // collides with another row's binding. The admin can still save — the
  // last-wins rule in useAgentShortcuts means they'll know which binding
  // currently owns the combo in practice.
  const conflictByAction = useMemo(() => {
    const byCombo = new Map<string, ShortcutActionKey[]>();
    bindings.forEach((b) => {
      if (!b.enabled || !b.combination) return;
      const arr = byCombo.get(b.combination) || [];
      arr.push(b.action);
      byCombo.set(b.combination, arr);
    });
    const result = new Map<ShortcutActionKey, string>();
    byCombo.forEach((actions, combo) => {
      if (actions.length < 2) return;
      const labelFor = (k: ShortcutActionKey) =>
        SHORTCUT_ACTIONS.find((a) => a.key === k)?.label || k;
      actions.forEach((k) => {
        const others = actions.filter((a) => a !== k).map(labelFor);
        result.set(k, others.join(', '));
      });
    });
    return result;
  }, [bindings]);

  const handleChange = async (
    action: ShortcutActionKey,
    next: { combination: string | null; enabled: boolean },
  ) => {
    try {
      await update.mutateAsync({ action, ...next });
      toast.success('تم حفظ الاختصار');
    } catch (err: any) {
      toast.error(err?.message || 'فشل في حفظ الاختصار');
    }
  };

  const handleReset = async (action: ShortcutActionKey) => {
    try {
      await reset.mutateAsync(action);
      toast.success('تمت إعادة الاختصار إلى الافتراضي');
    } catch (err: any) {
      toast.error(err?.message || 'فشل في إعادة الضبط');
    }
  };

  const bindingByAction = useMemo(() => {
    const m = new Map(bindings.map((b) => [b.action, b]));
    return m;
  }, [bindings]);

  const actionGroups = useMemo(() => {
    const groups: Record<string, typeof SHORTCUT_ACTIONS> = {
      actions: [],
      navigation: [],
    };
    SHORTCUT_ACTIONS.forEach((a) => {
      groups[a.category].push(a);
    });
    return groups;
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="h-5 w-5" />
          اختصارات لوحة المفاتيح
        </CardTitle>
        <CardDescription>
          خصّص مفاتيح الاختصار لأكثر الإجراءات استخداماً. تُطبَّق الاختصارات على
          جميع موظفي الوكيل تلقائياً. اضغط على الحقل لتسجيل مفتاح جديد، أو
          Backspace لإلغاء الاختصار. يتم تعطيل الاختصارات البسيطة (بدون
          Ctrl/Alt/Shift) داخل حقول الإدخال لتجنّب تعارضها مع الكتابة.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            جاري تحميل الاختصارات…
          </div>
        ) : (
          <>
            <ShortcutSection
              title="الإجراءات"
              actions={actionGroups.actions}
              bindingByAction={bindingByAction}
              conflictByAction={conflictByAction}
              onChange={handleChange}
              onReset={handleReset}
              pending={update.isPending || reset.isPending}
            />
            <ShortcutSection
              title="التنقل بين الصفحات"
              actions={actionGroups.navigation}
              bindingByAction={bindingByAction}
              conflictByAction={conflictByAction}
              onChange={handleChange}
              onReset={handleReset}
              pending={update.isPending || reset.isPending}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ShortcutSectionProps {
  title: string;
  actions: typeof SHORTCUT_ACTIONS;
  bindingByAction: Map<ShortcutActionKey, ReturnType<typeof useAgentShortcuts>['bindings'][number]>;
  conflictByAction: Map<ShortcutActionKey, string>;
  onChange: (
    action: ShortcutActionKey,
    next: { combination: string | null; enabled: boolean },
  ) => void;
  onReset: (action: ShortcutActionKey) => void;
  pending: boolean;
}

function ShortcutSection({
  title,
  actions,
  bindingByAction,
  conflictByAction,
  onChange,
  onReset,
  pending,
}: ShortcutSectionProps) {
  if (actions.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </div>
      <div className="rounded-lg border overflow-hidden divide-y">
        {actions.map((action) => {
          const binding = bindingByAction.get(action.key);
          const combination = binding?.combination ?? null;
          const enabled = binding?.enabled ?? true;
          const conflict = conflictByAction.get(action.key) || null;
          const isDefault = binding?.source === 'default';

          return (
            <div
              key={action.key}
              className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] items-start md:items-center gap-3 p-3 bg-background"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{action.label}</span>
                  {isDefault ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-muted/40 border-muted-foreground/20 text-muted-foreground font-medium"
                    >
                      افتراضي
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-primary/10 border-primary/20 text-primary font-medium"
                    >
                      مخصص
                    </Badge>
                  )}
                  {!enabled && (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-700 font-medium"
                    >
                      معطل
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {action.description}
                </p>
              </div>

              <ShortcutKeyCaptureInput
                value={combination}
                onChange={(next) =>
                  onChange(action.key, { combination: next, enabled })
                }
                conflictLabel={conflict}
                disabled={pending}
              />

              <div className="flex items-center gap-2 justify-end">
                <Switch
                  checked={enabled}
                  onCheckedChange={(next) =>
                    onChange(action.key, { combination, enabled: next })
                  }
                  disabled={pending}
                  aria-label={enabled ? 'تعطيل الاختصار' : 'تفعيل الاختصار'}
                />
                {!isDefault && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => onReset(action.key)}
                    disabled={pending}
                    title="إعادة إلى الافتراضي"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
