import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useAgentContext } from './useAgentContext';

/**
 * Every permission key used by the app, in one place so the editor
 * UI, Sidebar, and PermissionRoute all reference the same source of
 * truth. Grouped by sidebar section for the editor's layout.
 *
 * Convention:
 *   page.<slug>     — page / route access
 *   view_financial  — special: hides all profit/commission/debt
 *                     numbers across every page (one flag, not
 *                     per-page, per the product decision).
 */
export const PERMISSION_GROUPS = [
  {
    label: 'العمل اليومي',
    keys: [
      ['page.dashboard', 'الرئيسية'],
      ['page.tasks', 'المهام'],
      ['page.activity', 'سجل النشاط'],
      ['page.notifications', 'التنبيهات'],
      ['page.policy_reports', 'تقارير المعاملات والتجديدات'],
      ['page.clients', 'العملاء'],
      ['page.cars', 'السيارات'],
      ['page.policies', 'البوالص'],
      ['page.accidents', 'بلاغات الحوادث'],
      ['page.leads', 'رسائل WhatsApp'],
      ['page.contacts', 'جهات الاتصال'],
      ['page.media', 'الوسائط'],
      ['page.form_templates', 'الملفات'],
      ['page.repair_claims', 'المطالبات'],
    ],
  },
  {
    label: 'الإدارة والمالية',
    keys: [
      ['page.brokers', 'الوسطاء'],
      ['page.companies', 'الشركات'],
      ['page.accounting', 'المحاسبة'],
      ['page.cheques', 'الشيكات'],
      ['page.debt_tracking', 'متابعة الديون'],
      ['page.receipts', 'الإيصالات'],
      ['page.financial_reports', 'التقارير المالية'],
      ['page.company_settlement', 'تسوية الشركات'],
      ['page.elzami_costs', 'تقرير تكاليف الالتزام'],
      ['page.correspondence', 'المراسلات'],
      ['page.marketing_sms', 'SMS تسويقية'],
      ['page.sms_history', 'سجل الرسائل'],
      ['page.customer_signatures', 'توقيعات العملاء'],
    ],
  },
  {
    label: 'إعدادات الوكيل',
    keys: [
      ['page.users', 'المستخدمون'],
      ['page.branches', 'الفروع'],
      ['page.road_services', 'خدمات الطريق'],
      ['page.accident_fees', 'إعفاء رسوم الحادث'],
      ['page.branding', 'العلامة التجارية'],
      ['page.sms_settings', 'إعدادات SMS'],
      ['page.auth_settings', 'إعدادات المصادقة'],
      ['page.payment_settings', 'إعدادات الدفع'],
      ['page.invoice_templates', 'قوالب الفواتير'],
      ['page.insurance_categories', 'فئات التأمين'],
      ['page.database_migration', 'هجرة البيانات / استيراد'],
    ],
  },
  {
    label: 'خاص',
    keys: [
      ['view_financial', 'عرض الأرقام المالية (أرباح / عمولات / ديون)'],
    ],
  },
] as const;

export type PermissionKey =
  | (typeof PERMISSION_GROUPS)[number]['keys'][number][0]
  | string; // allow unknown keys so we can return false safely

/**
 * Hook returning the current user's permission resolver.
 *
 * Resolution order:
 *   1. Admin role (from useAuth.isAdmin) → always true (agent admin +
 *      Thiqa super admin + impersonating super admin all fall here).
 *   2. Explicit override on profiles.permissions[key].
 *   3. Agent template agents.default_employee_permissions[key].
 *   4. Missing → false.
 */
export function usePermissions() {
  const { user, isAdmin } = useAuth();
  const { agent, loading: agentLoading } = useAgentContext();
  const [userPermissions, setUserPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setUserPermissions({});
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('permissions')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        const raw = data?.permissions as unknown;
        const map =
          typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, boolean> | null) ?? {};
        setUserPermissions(map ?? {});
      } catch (error) {
        console.error('Error loading permissions:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const defaults = (agent?.default_employee_permissions ?? {}) as Record<string, boolean>;

  const can = (key: PermissionKey): boolean => {
    // Agent admin + super admin bypass the matrix entirely. This is
    // the product decision — the admin always sees everything in
    // their agent so they can configure it.
    if (isAdmin) return true;
    if (key in userPermissions) return userPermissions[key];
    if (key in defaults) return defaults[key];
    return false;
  };

  return {
    can,
    loading: loading || agentLoading,
    userPermissions,
    defaults,
  };
}
