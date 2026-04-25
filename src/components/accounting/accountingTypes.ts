import type { Enums } from '@/integrations/supabase/types';

export interface IssuanceRow {
  id: string;
  policy_number: string | null;
  issue_date: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  payed_for_company: number | null;
  profit: number | null;
  office_commission: number | null;
  policy_type_parent: Enums<'policy_type_parent'>;
  policy_type_child: Enums<'policy_type_child'> | null;
  cancelled: boolean | null;
  is_under_24: boolean | null;
  // joined
  client_name: string | null;
  car_id: string | null;
  car_number: string | null;
  car_type: Enums<'car_type'> | null;
  car_value: number | null;
  car_year: number | null;
  company_id: string | null;
  company_name: string | null;
  broker_id: string | null;
  // computed (lazy)
  receipts_count: number;
  receipts_total: number;
  primary_payment_method: string | null;
  primary_receipt_number: string | null;
}

export const POLICY_TYPE_DISPLAY: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD: 'ثالث',
  FULL: 'شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء حوادث',
  HEALTH: 'صحي',
};

export function policyTypeKey(parent: string, child: string | null): string {
  if (parent === 'THIRD_FULL' && child) return child;
  return parent;
}

export function policyTypeLabel(parent: string, child: string | null): string {
  return POLICY_TYPE_DISPLAY[policyTypeKey(parent, child)] ?? parent;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  transfer: 'تحويل بنكي',
  visa: 'فيزا',
  customer_cheque: 'شيك عميل',
};
