import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Save, Shield } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAgentContext } from '@/hooks/useAgentContext';
import { PermissionMatrix } from './PermissionMatrix';

/**
 * Agent-level default permissions for new employees.
 *
 * Edits agents.default_employee_permissions. Every new worker the
 * admin creates inherits this template unless they get a per-user
 * override via UserPermissionsDialog.
 *
 * Existing employees are NOT retroactively changed by editing this
 * card — each of them keeps their own profiles.permissions. The admin
 * has to open their row to re-apply the template.
 */
export function DefaultEmployeePermissionsCard() {
  const { agentId } = useAgentContext();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [initialSerialized, setInitialSerialized] = useState('{}');

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('agents')
          .select('default_employee_permissions')
          .eq('id', agentId)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const raw = data?.default_employee_permissions as unknown;
        const map =
          typeof raw === 'string'
            ? JSON.parse(raw)
            : (raw as Record<string, boolean> | null) ?? {};
        const clean = map ?? {};
        setPermissions(clean);
        setInitialSerialized(JSON.stringify(clean));
      } catch (err: any) {
        toast({
          title: 'خطأ',
          description: err.message || 'فشل تحميل الإعدادات الافتراضية',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, toast]);

  const dirty = JSON.stringify(permissions) !== initialSerialized;

  const handleSave = async () => {
    if (!agentId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('agents')
        .update({ default_employee_permissions: permissions })
        .eq('id', agentId);
      if (error) throw error;
      setInitialSerialized(JSON.stringify(permissions));
      toast({
        title: 'تم الحفظ',
        description: 'الإعدادات الافتراضية ستُطبَّق على أي موظف جديد تنشئه',
      });
    } catch (err: any) {
      toast({
        title: 'خطأ',
        description: err.message || 'فشل حفظ الإعدادات',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          الصلاحيات الافتراضية للموظفين الجدد
        </CardTitle>
        <CardDescription>
          هذه الصلاحيات تُطبَّق تلقائياً على أي موظف جديد تُنشئه في الوكالة.
          يمكنك لاحقاً تخصيص صلاحيات كل موظف على حدة من القائمة الرئيسية.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <PermissionMatrix value={permissions} onChange={setPermissions} />
            <div className="flex justify-end mt-6 pt-4 border-t">
              <Button onClick={handleSave} disabled={saving || !dirty} className="gap-2">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                حفظ الإعدادات الافتراضية
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
