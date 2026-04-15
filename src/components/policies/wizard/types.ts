// Types for Policy Wizard

export interface InsuranceCategory {
  id: string;
  name: string;
  name_ar: string | null;
  slug: string;
  mode: 'FULL' | 'LIGHT';
  is_active: boolean;
  is_default: boolean;
}

export interface Client {
  id: string;
  full_name: string;
  id_number: string;
  file_number: string | null;
  phone_number: string | null;
  phone_number_2?: string | null;
  birth_date?: string | null;
  less_than_24: boolean | null;
  under24_type?: 'none' | 'client' | 'additional_driver' | null;
  under24_driver_name?: string | null;
  under24_driver_id?: string | null;
  broker_id: string | null;
  accident_notes?: string | null;
}

export interface CarRecord {
  id: string;
  car_number: string;
  manufacturer_name: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  car_type: string | null;
  car_value: number | null;
  client_id: string;
}

export interface Company {
  id: string;
  name: string;
  name_ar: string | null;
  category_parent: string[] | null;
  elzami_commission: number | null;
  broker_id: string | null;  // If set, this company is linked to a broker
}

export interface Broker {
  id: string;
  name: string;
}

export interface RoadService {
  id: string;
  name: string;
  name_ar: string | null;
  allowed_car_types: string[];
  active: boolean;
}

export interface AccidentFeeService {
  id: string;
  name: string;
  name_ar: string | null;
  active: boolean;
}

export interface PackageAddon {
  type: 'elzami' | 'third_full' | 'road_service' | 'accident_fee_exemption';
  enabled: boolean;
  road_service_id?: string;
  accident_fee_service_id?: string;
  company_id?: string;
  insurance_price: string;
  // Independent dates for each addon (YYYY-MM-DD format)
  start_date?: string;
  end_date?: string;
  // ELZAMI specific fields
  elzami_commission?: number;
  office_commission?: string; // عمولة للمكتب for ELZAMI addon
  // THIRD_FULL specific fields
  policy_type_child?: '' | 'THIRD' | 'FULL';
  broker_buy_price?: string;
}

export interface PendingPaymentImages {
  paymentId: string;
  files: File[];
}

export interface PaymentLine {
  id: string;
  payment_type: string;
  amount: number;
  payment_date: string;
  cheque_number?: string;
  /** MICR bank code (e.g. "12" = Hapoalim). Only set when payment_type === 'cheque'. */
  bank_code?: string | null;
  /** Branch code assigned by the bank (typically 3 digits). */
  branch_code?: string | null;
  notes?: string;
  refused: boolean;
  tranzila_paid?: boolean;
  tranzila_transaction_id?: string;
  pendingImages?: File[]; // Store actual files for upload
  /** If true, this payment is system-generated and cannot be edited/deleted */
  locked?: boolean;
  /** Source of the payment: 'user' or 'system' */
  source?: 'user' | 'system';
  /** Label to display for locked payments (e.g., "دفعة إلزامي – تلقائية") */
  locked_label?: string;
  /** CDN URL for cheque image (from scanner) */
  cheque_image_url?: string;
}

export interface ValidationErrors {
  [key: string]: string;
}

export interface NewClientForm {
  full_name: string;
  id_number: string;
  phone_number: string;
  phone_number_2: string;
  birth_date: string;
  under24_type: 'none' | 'client' | 'additional_driver';
  under24_driver_name: string;
  under24_driver_id: string;
  notes: string;
}

export interface NewCarForm {
  car_number: string;
  manufacturer_name: string;
  model: string;
  year: string;
  color: string;
  car_type: string;
  car_value: string;
  license_expiry: string;
}

export interface PolicyForm {
  policy_type_parent: string;
  policy_type_child: string;
  company_id: string;
  start_date: string;
  end_date: string;
  issue_date: string; // تاريخ الإصدار - defaults to start_date
  insurance_price: string;
  broker_buy_price: string; // Price we buy from broker (when company has broker_id)
  full_car_value: string; // Car value for FULL insurance pricing (entered in Step 3)
  office_commission: string; // عمولة للمكتب - commission the agency charges for ELZAMI handling
  cancelled: boolean;
  transferred: boolean;
  notes: string;
  road_service_id: string;
  accident_fee_service_id: string;
}

export interface WizardStep {
  id: number;
  key: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  isUnlocked: boolean;
  isValid: boolean;
}

export interface PricingBreakdown {
  basePrice: number;
  elzamiPrice: number;
  thirdFullPrice: number;
  roadServicePrice: number;
  accidentFeePrice: number;
  officeCommission: number;
  totalPrice: number;
  /** Amount that goes through client wallet/debt (excludes ELZAMI but includes office commission) */
  payablePrice: number;
}

// Renewal data for pre-populating the wizard
export interface RenewalData {
  clientId: string;
  carId?: string | null;
  categorySlug: string;
  policyTypeParent: string;
  policyTypeChild?: string | null;
  companyId: string;
  insurancePrice: number;
  brokerBuyPrice?: number | null;
  notes?: string | null;
  // Package addons
  packageAddons?: {
    type: 'elzami' | 'third_full' | 'road_service' | 'accident_fee_exemption';
    companyId: string;
    insurancePrice: number;
    roadServiceId?: string;
    accidentFeeServiceId?: string;
    policyTypeChild?: string;
    brokerBuyPrice?: number | null;
  }[];
  // Additional drivers
  childrenIds?: string[];
  // Original end date for calculating new dates
  originalEndDate?: string;
}

// Constants
export const CAR_POLICY_TYPES = [
  { value: "ELZAMI", label: "إلزامي", requiresBroker: false },
  { value: "THIRD_FULL", label: "ثالث/شامل", hasChild: true, requiresBroker: true },
  { value: "ROAD_SERVICE", label: "خدمات الطريق", requiresBroker: false },
  { value: "ACCIDENT_FEE_EXEMPTION", label: "إعفاء رسوم حادث", requiresBroker: false },
];

export const CAR_TYPES = [
  { value: "car", label: "خصوصي" },
  { value: "cargo", label: "شحن" },
  { value: "small", label: "اوتوبس زعير" },
  { value: "taxi", label: "تاكسي" },
  { value: "tjeradown4", label: "تجاري (أقل من 4 طن)" },
  { value: "tjeraup4", label: "تجاري (أكثر من 4 طن)" },
];

export const PAYMENT_TYPES_BASE = [
  { value: "cash", label: "نقدي" },
  { value: "cheque", label: "شيك" },
  { value: "transfer", label: "تحويل" },
];

export const PAYMENT_TYPES = [
  ...PAYMENT_TYPES_BASE,
  { value: "visa", label: "فيزا" },
];

export function getPaymentTypes(visaEnabled: boolean) {
  return visaEnabled ? PAYMENT_TYPES : PAYMENT_TYPES_BASE;
}
