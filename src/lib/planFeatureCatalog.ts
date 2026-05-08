// Single source of truth for the gate-able feature list that appears
// in the agent-side plan overview (AgentPlanOverview) and in the
// upgrade popup per-card "view all features" expansion. Keys must
// match the `default_features` JSON keys written by Thiqa admin in
// ThiqaSettings.SYSTEM_FEATURES and resolved by useAgentContext.hasFeature.

export interface PlanFeature {
  key: string;
  label: string;
}

export interface PlanFeatureGroup {
  group: string;
  items: PlanFeature[];
}

export const PLAN_FEATURE_CATALOG: PlanFeatureGroup[] = [
  {
    group: 'العمل اليومي',
    items: [
      { key: 'dashboard', label: 'لوحة التحكم' },
      { key: 'tasks', label: 'صفحة المهام + السجل' },
      { key: 'contacts', label: 'جهات الاتصال' },
      { key: 'accident_reports', label: 'بلاغات الحوادث' },
      { key: 'correspondence', label: 'المراسلات' },
      { key: 'renewals', label: 'تجديدات البوالص' },
      { key: 'notifications', label: 'التنبيهات' },
    ],
  },
  {
    group: 'الملفات والتوقيعات',
    items: [
      { key: 'files_upload', label: 'رفع الملفات' },
      { key: 'files_explorer', label: 'مستكشف الملفات' },
      { key: 'digital_signatures', label: 'التوقيعات الرقمية' },
    ],
  },
  {
    group: 'التواصل',
    items: [
      { key: 'sms', label: 'إرسال SMS' },
      { key: 'marketing_sms', label: 'SMS تسويقية' },
      { key: 'ai_assistant', label: 'المساعد الذكي (ثاقب)' },
      { key: 'whatsapp_ai_agent', label: 'بوت الواتساب للعملاء' },
    ],
  },
  {
    group: 'المالية والإدارة',
    items: [
      { key: 'financial_reports', label: 'التقارير المالية' },
      { key: 'broker_wallet', label: 'محفظة الوسطاء' },
      { key: 'company_settlement', label: 'التسويات مع الشركات' },
      { key: 'accounting', label: 'المحاسبة' },
      { key: 'receipts', label: 'الإيصالات' },
      { key: 'cheques', label: 'الشيكات' },
      { key: 'debt_tracking', label: 'متابعة الديون' },
      { key: 'repair_claims', label: 'المطالبات' },
    ],
  },
];
