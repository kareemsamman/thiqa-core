// Source of truth for the agent app's navigation. Lives in its own
// module (separate from Sidebar.tsx) so other modules — usePermissions
// in particular, which derives the per-user permission matrix from
// these groups — can import navigationGroups without dragging in the
// entire Sidebar component tree (or creating a circular import).

import {
  Icon,
  SquaresFour,
  Users,
  FileText,
  Buildings,
  UserGear,
  Bell,
  ChartBar,
  Wallet,
  CreditCard,
  Image,
  Signature,
  CurrencyDollar,
  ClockCounterClockwise,
  Pulse,
  Truck,
  Shield,
  Megaphone,
  Warning,
  ListChecks,
  AddressBook,
  FileX,
  Envelope,
  Gear,
  Palette,
  Crown,
} from "@phosphor-icons/react";

export interface NavItem {
  name: string;
  href: string;
  icon: Icon;
  /**
   * Legacy admin-only marker. Keep so the type stays backward-compatible
   * with NavigationSearch etc., but the Sidebar now derives visibility
   * from permissionKey — adminOnly is only used as a hint that an item
   * belongs to the "settings" bucket.
   */
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  thiqaSuperAdminOnly?: boolean;
  /**
   * Plan-level gate. If the agent's plan doesn't include this feature,
   * hide the item. featureKey → hasFeature() from useAgentContext.
   */
  featureKey?: string;
  /**
   * Per-user visibility gate. If the logged-in user's permissions map
   * (or the agent's default_employee_permissions fallback) resolves
   * this key to false, hide the item. permissionKey → can() from
   * usePermissions. Agent admin always passes.
   */
  permissionKey?: string;
  badge?: 'notifications' | 'debt' | 'tasks' | 'claims' | 'accidents' | 'renewals';
}

export interface NavGroup {
  name: string;
  icon: Icon;
  items: NavItem[];
  adminOnly?: boolean;
  defaultOpen?: boolean;
}

// Navigation structure with groups - exported for NavigationSearch.
//
// Routes intentionally hidden from the agent sidebar (still reachable
// by direct URL): /cars, /policies, /reports/company-settlement,
// /reports/financial, /admin/insurance-categories. Per the agent's
// updated nav spec — drop these from the menu, keep the routes.
export const navigationGroups: NavGroup[] = [
  {
    name: "الرئيسية",
    icon: SquaresFour,
    defaultOpen: true,
    items: [
      { name: "لوحة التحكم", href: "/dashboard", icon: SquaresFour, featureKey: 'dashboard', permissionKey: 'page.dashboard' },
      { name: "المهام", href: "/tasks", icon: ListChecks, badge: 'tasks', featureKey: 'tasks', permissionKey: 'page.tasks' },
      { name: "سجل النشاط", href: "/activity", icon: Pulse, featureKey: 'tasks', permissionKey: 'page.activity' },
      { name: "التنبيهات", href: "/notifications", icon: Bell, badge: 'notifications', featureKey: 'notifications', permissionKey: 'page.notifications' },
      { name: "تقارير المعاملات والتجديدات", href: "/reports/policies", icon: ChartBar, badge: 'renewals', featureKey: 'renewals', permissionKey: 'page.policy_reports' },
    ],
  },
  {
    name: "العملاء والشركات",
    icon: Users,
    items: [
      { name: "العملاء", href: "/clients", icon: Users, permissionKey: 'page.clients' },
      { name: "الوسطاء", href: "/brokers", icon: Wallet, featureKey: 'broker_wallet', permissionKey: 'page.brokers' },
      { name: "الشركات", href: "/companies", icon: Buildings, permissionKey: 'page.companies' },
      { name: "بلاغات الحوادث", href: "/accidents", icon: Warning, badge: 'accidents', featureKey: 'accident_reports', permissionKey: 'page.accidents' },
    ],
  },
  {
    name: "المالية",
    icon: Wallet,
    items: [
      { name: "متابعة الديون", href: "/debt-tracking", icon: CurrencyDollar, badge: 'debt', featureKey: 'debt_tracking', permissionKey: 'page.debt_tracking' },
      { name: "الشيكات", href: "/cheques", icon: CreditCard, featureKey: 'cheques', permissionKey: 'page.cheques' },
      { name: "الإيصالات", href: "/receipts", icon: FileText, featureKey: 'receipts', permissionKey: 'page.receipts' },
      { name: "المحاسبة", href: "/accounting", icon: CurrencyDollar, featureKey: 'accounting', permissionKey: 'page.accounting' },
    ],
  },
  {
    name: "أخرى",
    icon: Image,
    items: [
      { name: "جهات الاتصال", href: "/contacts", icon: AddressBook, featureKey: 'contacts', permissionKey: 'page.contacts' },
      { name: "المطالبات", href: "/admin/claims", icon: FileX, badge: 'claims', featureKey: 'repair_claims', permissionKey: 'page.repair_claims' },
      { name: "الوسائط", href: "/media", icon: Image, featureKey: 'files_upload', permissionKey: 'page.media' },
      { name: "ملفات", href: "/form-templates", icon: FileText, featureKey: 'files_explorer', permissionKey: 'page.form_templates' },
      { name: "المراسلات", href: "/admin/correspondence", icon: Envelope, featureKey: 'correspondence', permissionKey: 'page.correspondence' },
      { name: "SMS تسويقية", href: "/admin/marketing-sms", icon: Megaphone, featureKey: 'marketing_sms', permissionKey: 'page.marketing_sms' },
      { name: "سجل الرسائل", href: "/sms-history", icon: ClockCounterClockwise, featureKey: 'sms', permissionKey: 'page.sms_history' },
      { name: "توقيعات العملاء", href: "/admin/customer-signatures", icon: Signature, featureKey: 'digital_signatures', permissionKey: 'page.customer_signatures' },
    ],
  },
  {
    name: "الإعدادات",
    icon: Gear,
    items: [
      { name: "المستخدمون", href: "/admin/users", icon: UserGear, permissionKey: 'page.users' },
      { name: "الفروع", href: "/admin/branches", icon: Buildings, permissionKey: 'page.branches' },
      { name: "خدمات الطريق", href: "/admin/road-services", icon: Truck, featureKey: 'road_services', permissionKey: 'page.road_services' },
      { name: "إعفاء رسوم الحادث", href: "/admin/accident-fee-services", icon: Shield, featureKey: 'accident_fees', permissionKey: 'page.accident_fees' },
      { name: "العلامة التجارية", href: "/admin/branding", icon: Palette, permissionKey: 'page.branding' },
    ],
  },
  {
    name: "إدارة ثقة",
    icon: Crown,
    items: [
      { name: "لوحة التحكم", href: "/thiqa", icon: SquaresFour, thiqaSuperAdminOnly: true },
      { name: "الوكلاء", href: "/thiqa/agents", icon: Buildings, thiqaSuperAdminOnly: true },
      { name: "سجل المدفوعات", href: "/thiqa/payments", icon: CreditCard, thiqaSuperAdminOnly: true },
      { name: "إعلانات النظام", href: "/thiqa/announcements", icon: Megaphone, thiqaSuperAdminOnly: true },
      { name: "إعدادات المنصة", href: "/thiqa/settings", icon: Gear, thiqaSuperAdminOnly: true },
      { name: "تحليلات الموقع", href: "/thiqa/analytics", icon: ChartBar, thiqaSuperAdminOnly: true },
    ],
  },
];

// Fallback route for logged-in agents when /dashboard is locked on
// their plan — walks the sidebar in order and returns the href of the
// first item that's both permitted (can) and feature-unlocked
// (hasFeature). Used by Landing ("/") so login doesn't dump users on
// /subscription just because dashboard is off.
export function getFirstAccessibleRoute(
  hasFeature: (key: string) => boolean,
  can: (key: string) => boolean,
  isThiqaSuperAdmin: boolean,
): string | null {
  for (const group of navigationGroups) {
    for (const item of group.items) {
      if (item.thiqaSuperAdminOnly && !isThiqaSuperAdmin) continue;
      if (item.permissionKey && !can(item.permissionKey)) continue;
      if (item.featureKey && !isThiqaSuperAdmin && !hasFeature(item.featureKey)) continue;
      return item.href;
    }
  }
  return null;
}
