import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAgentContext } from '@/hooks/useAgentContext';
import { PermissionMatrix } from './PermissionMatrix';

interface UserRow {
  id: string;
  full_name: string | null;
  email: string;
  role?: 'admin' | 'worker';
}

interface UserPermissionsDialogProps {
  user: UserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

/**
 * Per-user permission editor. Opens for a selected employee, loads
 * their profiles.permissions JSONB, lets the agent admin toggle each
 * key, and writes the map back.
 *
 * Admins (role='admin') bypass permissions entirely via usePermissions,
 * so this dialog just tells the admin that editing has no effect on
 * them. For workers we persist the explicit map — any key left out
 * falls back to agents.default_employee_permissions.
 */
export function UserPermissionsDialog({
  user,
  open,
  onOpenChange,
  onSaved,
}: UserPermissionsDialogProps) {
  const { toast } = useToast();
  const { agentId } = useAgentContext();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [usingDefaults, setUsingDefaults] = useState(false);

  const isUserAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!user || !open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Load both the worker's per-user override and the agent's
        // default template in parallel. Runtime resolution
        // (usePermissions.can) already falls through user → defaults
        // → false; we mirror that here so the editor matches reality.
        const [profileRes, agentRes] = await Promise.all([
          supabase
            .from('profiles')
            .select('permissions')
            .eq('id', user.id)
            .maybeSingle(),
          agentId
            ? supabase
                .from('agents')
                .select('default_employee_permissions')
                .eq('id', agentId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (profileRes.error) throw profileRes.error;
        if (cancelled) return;

        const parseMap = (raw: unknown): Record<string, boolean> => {
          if (raw == null) return {};
          if (typeof raw === 'string') {
            try { return JSON.parse(raw) ?? {}; } catch { return {}; }
          }
          return (raw as Record<string, boolean>) ?? {};
        };

        const userMap = parseMap(profileRes.data?.permissions);
        const defaultMap = parseMap(agentRes.data?.default_employee_permissions);

        // If the worker has no per-user override, seed the matrix
        // from the agent defaults so the admin sees what the worker
        // actually has access to (not an empty/misleading matrix).
        // Saving without changes will then persist the defaults as
        // an explicit override — which is fine; the "Reset to
        // defaults" button can clear it back to empty later.
        const isEmpty = Object.keys(userMap).length === 0;
        setUsingDefaults(isEmpty);
        setPermissions(isEmpty ? defaultMap : userMap);
      } catch (err: any) {
        toast({
          title: 'خطأ',
          description: err.message || 'فشل تحميل الصلاحيات',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, open, agentId, toast]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ permissions })
        .eq('id', user.id);
      if (error) throw error;
      toast({ title: 'تم الحفظ', description: 'تم تحديث صلاحيات المستخدم' });
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: 'خطأ',
        description: err.message || 'فشل حفظ الصلاحيات',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    if (!agentId) return;
    // Re-pull defaults so the matrix reflects what "reset" actually
    // means right now (not whatever was loaded when the dialog opened).
    try {
      const { data } = await supabase
        .from('agents')
        .select('default_employee_permissions')
        .eq('id', agentId)
        .maybeSingle();
      const raw = data?.default_employee_permissions;
      const defaultMap: Record<string, boolean> =
        typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, boolean>) ?? {};
      setPermissions(defaultMap);
      setUsingDefaults(true);
    } catch {
      setPermissions({});
      setUsingDefaults(true);
    }
    toast({
      title: 'تمت إعادة الافتراضي',
      description: 'تم تحميل الإعدادات الافتراضية للوكالة. اضغط حفظ لتثبيتها.',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0" dir="rtl">
        <DialogHeader className="px-6 py-4 border-b bg-background">
          <DialogTitle>
            صلاحيات المستخدم — {user?.full_name || user?.email || ''}
          </DialogTitle>
          <DialogDescription>
            اختر الصفحات التي يستطيع هذا الموظف الوصول إليها. أي صفحة تتركها فارغة سيرث الموظف فيها إعدادات الوكالة الافتراضية.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 bg-muted/20">
          {isUserAdmin && (
            <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm">
              <strong>تنبيه:</strong> هذا المستخدم ادمن الوكالة — يملك كل الصلاحيات تلقائياً ولا يمكن تقييده.
            </div>
          )}

          {!isUserAdmin && !loading && usingDefaults && (
            <div className="mb-4 p-3 rounded-lg border border-blue-500/30 bg-blue-500/5 text-sm text-foreground">
              يتم عرض الإعدادات الافتراضية للوكالة لأن هذا الموظف ليس له صلاحيات مخصصة بعد. أي تعديل وحفظ سيُثبّت الصلاحيات لهذا الموظف تحديداً.
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <PermissionMatrix
              value={permissions}
              onChange={setPermissions}
              disabled={isUserAdmin}
            />
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-background gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetToDefaults}
            disabled={saving || loading || isUserAdmin}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            إعادة إلى الإعدادات الافتراضية
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving || loading || isUserAdmin}>
            {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
