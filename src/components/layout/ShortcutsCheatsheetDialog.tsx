// A read-only "cheatsheet" panel that lists every shortcut the admin
// has configured for the current agent. Staff can open it from any
// page via the keyboard icon in the header or via the configured
// shortcut (F1 by default) and instantly see which key does what
// without digging into /admin/branding.

import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Keyboard, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useAgentShortcuts } from '@/hooks/useAgentShortcuts';
import {
  SHORTCUT_ACTIONS,
  formatComboForDisplay,
  type ShortcutAction,
} from '@/lib/shortcuts';

interface ShortcutsCheatsheetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsCheatsheetDialog({
  open,
  onOpenChange,
}: ShortcutsCheatsheetDialogProps) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { bindings } = useAgentShortcuts();

  // Build the row for each action — even unbound ones show up (grayed
  // out) so staff see what's POSSIBLE to bind, not just what's active.
  // That way an admin can glance at the panel and decide to rebind.
  const rows = useMemo(() => {
    const byAction = new Map(bindings.map((b) => [b.action, b]));
    return SHORTCUT_ACTIONS.map((action) => {
      const binding = byAction.get(action.key);
      return {
        action,
        combination: binding?.combination ?? null,
        enabled: binding?.enabled ?? true,
      };
    });
  }, [bindings]);

  const grouped = useMemo(() => {
    const actions: typeof rows = [];
    const navigation: typeof rows = [];
    rows.forEach((r) => {
      if (r.action.category === 'navigation') navigation.push(r);
      else actions.push(r);
    });
    return { actions, navigation };
  }, [rows]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            اختصارات لوحة المفاتيح
          </DialogTitle>
          <DialogDescription>
            اختصارات المفاتيح المخصصة للوكيل. يمكنك الضغط على المفاتيح من أي
            صفحة داخل التطبيق لتنفيذ الإجراء المقابل.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <CheatsheetSection title="الإجراءات" rows={grouped.actions} />
          <CheatsheetSection title="التنقل" rows={grouped.navigation} />
        </div>

        {isAdmin && (
          <div className="flex items-center justify-between gap-3 pt-3 mt-2 border-t">
            <p className="text-[11px] text-muted-foreground">
              يمكن للمسؤول تعديل أو تعطيل الاختصارات من الإعدادات.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                onOpenChange(false);
                navigate('/admin/branding');
              }}
            >
              <Settings className="h-3.5 w-3.5" />
              تعديل الاختصارات
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface CheatsheetSectionProps {
  title: string;
  rows: {
    action: ShortcutAction;
    combination: string | null;
    enabled: boolean;
  }[];
}

function CheatsheetSection({ title, rows }: CheatsheetSectionProps) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
        {title}
      </div>
      <div className="rounded-lg border divide-y overflow-hidden">
        {rows.map(({ action, combination, enabled }) => {
          const isActive = enabled && !!combination;
          return (
            <div
              key={action.key}
              className="flex items-center justify-between gap-4 px-3 py-2.5 bg-background"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={
                      isActive ? 'font-semibold text-sm' : 'text-sm text-muted-foreground'
                    }
                  >
                    {action.label}
                  </span>
                  {!enabled && (
                    <Badge
                      variant="outline"
                      className="text-[9px] bg-amber-500/10 border-amber-500/30 text-amber-700 font-medium"
                    >
                      معطل
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                  {action.description}
                </p>
              </div>
              <KeyboardKey combo={combination} active={isActive} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KeyboardKey({
  combo,
  active,
}: {
  combo: string | null;
  active: boolean;
}) {
  if (!combo) {
    return (
      <span className="text-[11px] text-muted-foreground shrink-0">
        غير مخصص
      </span>
    );
  }
  // Break "ctrl+shift+n" into individual <kbd> chips so each key is
  // visually distinct — easier to scan than a single "Ctrl+Shift+N" run.
  const parts = formatComboForDisplay(combo).split(/(?=[A-Z])|(?<=[a-z0-9])/);
  // Fallback: platform display joins parts with "+" or "⌘/⌥" on Mac; we
  // split on the store-form instead to keep key separation consistent.
  const storeParts = combo.split('+').map((p) => p.trim());
  return (
    <div
      className={
        active
          ? 'flex items-center gap-1 shrink-0'
          : 'flex items-center gap-1 shrink-0 opacity-60'
      }
    >
      {storeParts.map((p, i) => {
        const label = formatComboForDisplay(p);
        return (
          <kbd
            key={`${p}-${i}`}
            className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-md bg-muted border border-border text-[11px] font-mono font-semibold ltr-nums"
          >
            {label}
          </kbd>
        );
      })}
    </div>
  );
}
