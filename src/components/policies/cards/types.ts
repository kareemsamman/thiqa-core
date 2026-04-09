export interface PolicyRecord {
  id: string;
  client_id: string;
  car_id: string;
  company_id: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  office_commission: number | null;
  profit: number | null;
  payed_for_company: number | null;
  elzami_cost: number | null;
  cancelled: boolean | null;
  transferred: boolean | null;
  transferred_car_number: string | null;
  is_under_24: boolean | null;
  notes: string | null;
  broker_id: string | null;
  created_by_admin_id: string | null;
  group_id: string | null;
  branch_id: string | null;
  created_at?: string;
  road_service_id?: string | null;
  accident_fee_service_id?: string | null;
  clients?: {
    id: string;
    full_name: string;
    less_than_24: boolean | null;
    phone_number?: string | null;
    file_number?: string | null;
  };
  cars?: {
    id: string;
    car_number: string;
    car_type: string | null;
    car_value: number | null;
    year: number | null;
    manufacturer_name?: string | null;
  };
  insurance_companies?: {
    id: string;
    name: string;
    name_ar: string | null;
  };
  road_services?: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  accident_fee_services?: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  created_by?: {
    full_name: string | null;
    email: string;
  };
}

export interface PolicyGroup {
  groupId: string | null;
  mainPolicy: PolicyRecord | null;
  addons: PolicyRecord[];
  isActive: boolean;
  newestDate: Date;
  priority: number;
  client: PolicyRecord['clients'];
  car: PolicyRecord['cars'];
}

export interface PaymentStatus {
  totalPrice: number;
  totalPaid: number;
  remaining: number;
  isPaid: boolean;
}

export interface PaymentInfo {
  [policyId: string]: { paid: number; remaining: number };
}

export const policyTypeLabels: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
};

export const policyChildLabels: Record<string, string> = {
  THIRD: 'ثالث',
  FULL: 'شامل',
};

export const policyTypeColors: Record<string, string> = {
  ELZAMI: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  THIRD_FULL: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  ROAD_SERVICE: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  ACCIDENT_FEE_EXEMPTION: 'bg-green-500/10 text-green-600 border-green-500/20',
};

export const getDisplayLabel = (policy: PolicyRecord) => {
  if (policy.policy_type_parent === 'THIRD_FULL' && policy.policy_type_child) {
    return policyChildLabels[policy.policy_type_child] || policy.policy_type_child;
  }
  return policyTypeLabels[policy.policy_type_parent] || policy.policy_type_parent;
};

export const getPolicyStatus = (policy: PolicyRecord) => {
  if (policy.cancelled) return { label: 'ملغاة', variant: 'destructive' as const, isActive: false, priority: 4 };
  if (policy.transferred) return { label: 'محولة', variant: 'warning' as const, isActive: false, priority: 3 };
  const endDate = new Date(policy.end_date);
  const today = new Date();
  if (endDate < today) return { label: 'منتهية', variant: 'secondary' as const, isActive: false, priority: 2 };
  return { label: 'سارية', variant: 'success' as const, isActive: true, priority: 1 };
};
