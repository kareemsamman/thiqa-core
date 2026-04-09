import { Enums } from '@/integrations/supabase/types';

export type PolicyTypeParent = Enums<'policy_type_parent'>;
export type PolicyTypeChild = Enums<'policy_type_child'>;

export const POLICY_TYPE_LABELS: Record<PolicyTypeParent, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'طرف ثالث / شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حوادث',
  HEALTH: 'تأمين صحي',
  LIFE: 'تأمين حياة',
  PROPERTY: 'تأمين ممتلكات',
  TRAVEL: 'تأمين سفر',
  BUSINESS: 'تأمين أعمال',
  OTHER: 'أخرى',
};

export const POLICY_CHILD_LABELS: Record<PolicyTypeChild, string> = {
  THIRD: 'ثالث',
  FULL: 'شامل',
};

/**
 * Returns a consistent badge className for each insurance type
 * High contrast, unique colors per type
 */
export function getInsuranceTypeBadgeClass(type: PolicyTypeParent): string {
  const baseClass = 'font-medium border';
  
  switch (type) {
    case 'ELZAMI':
      return `${baseClass} bg-amber-100 text-amber-800 border-amber-400 hover:bg-amber-200`;
    case 'THIRD_FULL':
      return `${baseClass} bg-blue-100 text-blue-800 border-blue-400 hover:bg-blue-200`;
    case 'ROAD_SERVICE':
      return `${baseClass} bg-purple-100 text-purple-800 border-purple-400 hover:bg-purple-200`;
    case 'ACCIDENT_FEE_EXEMPTION':
      return `${baseClass} bg-orange-100 text-orange-800 border-orange-400 hover:bg-orange-200`;
    case 'HEALTH':
      return `${baseClass} bg-emerald-100 text-emerald-800 border-emerald-400 hover:bg-emerald-200`;
    case 'LIFE':
      return `${baseClass} bg-rose-100 text-rose-800 border-rose-400 hover:bg-rose-200`;
    case 'PROPERTY':
      return `${baseClass} bg-slate-200 text-slate-900 border-slate-500 hover:bg-slate-300`;
    case 'TRAVEL':
      return `${baseClass} bg-cyan-100 text-cyan-800 border-cyan-400 hover:bg-cyan-200`;
    case 'BUSINESS':
      return `${baseClass} bg-indigo-100 text-indigo-800 border-indigo-400 hover:bg-indigo-200`;
    case 'OTHER':
    default:
      return `${baseClass} bg-gray-200 text-gray-800 border-gray-400 hover:bg-gray-300`;
  }
}

/**
 * Get child type badge class (THIRD / FULL)
 */
export function getInsuranceChildBadgeClass(type: PolicyTypeChild | null): string {
  if (!type) return '';
  
  const baseClass = 'font-medium border';
  
  switch (type) {
    case 'THIRD':
      return `${baseClass} bg-sky-100 text-sky-800 border-sky-400`;
    case 'FULL':
      return `${baseClass} bg-teal-100 text-teal-800 border-teal-400`;
    default:
      return `${baseClass} bg-gray-200 text-gray-800 border-gray-400`;
  }
}

/**
 * Get the display label for a policy type
 */
export function getInsuranceTypeLabel(
  parent: PolicyTypeParent, 
  child?: PolicyTypeChild | null
): string {
  if (child && (parent === 'THIRD_FULL')) {
    return POLICY_CHILD_LABELS[child];
  }
  return POLICY_TYPE_LABELS[parent] || parent;
}
