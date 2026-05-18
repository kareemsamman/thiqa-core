import { ColumnOption } from './ManageColumnsDropdown';

export const COMPANY_ISSUANCE_COLUMNS: ColumnOption[] = [
  { key: 'row_number', label: '#' },
  { key: 'client_name', label: 'العميل' },
  { key: 'document_number', label: 'رقم المعاملة', required: true },
  { key: 'client_id_number', label: 'رقم هوية العميل' },
  { key: 'client_phone', label: 'رقم الهاتف' },
  { key: 'issue_date', label: 'تاريخ الإصدار' },
  { key: 'start_date', label: 'بدء التأمين' },
  { key: 'end_date', label: 'نهاية التأمين' },
  { key: 'car_number', label: 'رقم السيارة' },
  { key: 'car_value', label: 'سعر السيارة' },
  { key: 'company_name', label: 'شركة التأمين' },
  { key: 'policy_type', label: 'نوع التأمين' },
  { key: 'payed_for_company', label: 'المستحق للشركة' },
  { key: 'profit', label: 'الربح / العمولة' },
  { key: 'insurance_price', label: 'سعر التأمين' },
  { key: 'actions', label: 'إجراءات', required: true },
];

export const BROKER_ISSUANCE_COLUMNS: ColumnOption[] = [
  { key: 'row_number', label: '#' },
  { key: 'client_name', label: 'العميل' },
  { key: 'document_number', label: 'رقم المعاملة', required: true },
  { key: 'client_id_number', label: 'رقم هوية العميل' },
  { key: 'client_phone', label: 'رقم الهاتف' },
  { key: 'issue_date', label: 'تاريخ الإصدار' },
  { key: 'start_date', label: 'بدء التأمين' },
  { key: 'end_date', label: 'نهاية التأمين' },
  { key: 'car_number', label: 'رقم السيارة' },
  { key: 'car_value', label: 'سعر السيارة' },
  { key: 'company_name', label: 'الوسيط / الشركة' },
  { key: 'policy_type', label: 'نوع التأمين' },
  { key: 'payed_for_company', label: 'المستحق للشركة' },
  { key: 'broker_buy_price', label: 'سعر الشراء من الوسيط' },
  { key: 'insurance_price', label: 'سعر البيع للعميل' },
  { key: 'profit', label: 'الربح' },
  { key: 'actions', label: 'إجراءات', required: true },
];

export const ISSUANCE_DEFAULT_OFF = new Set(['client_id_number', 'client_phone']);

export const SETTLEMENT_COLUMNS: ColumnOption[] = [
  { key: 'voucher_number', label: 'رقم السند', required: true },
  { key: 'date', label: 'التاريخ', required: true },
  { key: 'entity', label: 'الجهة', required: true },
  { key: 'amount', label: 'المبلغ', required: true },
  { key: 'payment_type', label: 'طريقة الدفع' },
  { key: 'cheque_number', label: 'رقم الشيك' },
  { key: 'cheque_image', label: 'المرفق' },
  { key: 'direction', label: 'الاتجاه' },
  { key: 'status', label: 'الحالة' },
  { key: 'notes', label: 'ملاحظات' },
];

export const SETTLEMENT_DEFAULT_OFF = new Set(['notes']);

// Columns used by the simpler company-section voucher tables — سند
// الصرف / سند القبض (CompanySettlementsTable) and إشعار دائن / إشعار
// مدين (CompanyCreditNotesTable). The heavier SETTLEMENT_COLUMNS set
// above belongs to the broker-side SettlementsTable, which renders
// cheque image, status, customer-cheque accordion — none of those
// belong on the lean accounting-page view.
export const COMPANY_SETTLEMENT_COLUMNS: ColumnOption[] = [
  { key: 'voucher_number', label: 'رقم السند', required: true },
  { key: 'date', label: 'التاريخ', required: true },
  { key: 'entity', label: 'الشركة', required: true },
  { key: 'payment_method', label: 'طريقة الدفع' },
  { key: 'amount', label: 'المبلغ', required: true },
  { key: 'notes', label: 'ملاحظات' },
];

export const COMPANY_SETTLEMENT_DEFAULT_OFF = new Set<string>(['notes']);

// Customer-side accounting columns. Per user feedback the receipt
// tables don't surface cheque/bank detail (that lives on /receipts);
// they emphasize CUSTOMER context — id number, phone, car — so the
// agent reading the accounting page can tie an unfamiliar voucher
// number back to the person/vehicle without leaving the screen.
// The "المعاملة" column was intentionally dropped: per the user,
// "ما في اشي ببين انوا السند للمعاملة" — a سند can span multiple
// معاملات, so showing one document number was misleading.
export const CLIENT_RECEIPT_COLUMNS: ColumnOption[] = [
  { key: 'voucher_number', label: 'رقم السند', required: true },
  { key: 'date', label: 'التاريخ', required: true },
  { key: 'client_name', label: 'العميل', required: true },
  { key: 'client_id_number', label: 'رقم الهوية' },
  { key: 'client_phone', label: 'الهاتف' },
  { key: 'car_number', label: 'رقم السيارة' },
  { key: 'payment_method', label: 'طريقة الدفع' },
  { key: 'amount', label: 'المبلغ', required: true },
  { key: 'notes', label: 'ملاحظات' },
];

export const CLIENT_RECEIPT_DEFAULT_OFF = new Set([
  'client_id_number',
  'client_phone',
  'car_number',
  'notes',
]);

export const CLIENT_ISSUANCE_COLUMNS: ColumnOption[] = [
  { key: 'document_number', label: 'رقم المعاملة', required: true },
  { key: 'date', label: 'التاريخ', required: true },
  { key: 'client_name', label: 'العميل', required: true },
  { key: 'client_id_number', label: 'رقم الهوية' },
  { key: 'client_phone', label: 'الهاتف' },
  { key: 'car_number', label: 'رقم السيارة' },
  { key: 'types', label: 'الأنواع' },
  { key: 'billed', label: 'المبلغ المستحق', required: true },
  { key: 'paid', label: 'المدفوع' },
  { key: 'status', label: 'الحالة' },
];

export const CLIENT_ISSUANCE_DEFAULT_OFF = new Set([
  'client_id_number',
  'client_phone',
]);
